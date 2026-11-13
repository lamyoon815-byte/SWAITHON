"""감상 피드백: 만족도와 음성 의견(글자)을 저장하고, 그 의견을 개인 설정 조정 제안으로 바꾼다.

- 모델을 다시 학습시키지 않는다. 이 사용자의 보정값·해설 선호만 바꾼다.
- Gemini는 의견을 FeedbackIntent의 정해진 선택지로만 분류한다. 한 단계의 크기와 범위는 서버가 정한다.
- 앱은 apply=true로 보내 해석한 즉시 적용한다(저시력 사용자가 글자를 읽고 고르는 화면을 없앰).
  무엇을 바꿨는지는 응답 문장을 음성으로 읽어 알린다. apply=false면 제안만 돌려주고, 나중에 고른 것만 적용할 수 있다.
- 음성 원본은 받지 않는다. 앱이 /transcribe로 바꾼 글자만 저장한다.
"""

from contextlib import closing
from datetime import datetime, timezone
import json
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

if __package__:
    from .accounts import RateLimiter, VisualProfile
    from .gemini import FeedbackIntent
else:
    from accounts import RateLimiter, VisualProfile
    from gemini import FeedbackIntent


Satisfaction = Literal["good", "okay", "bad"]
SuggestionField = Literal["color_severity", "contrast", "brightness", "sharpen", "edge", "speech_rate",
                          "narration_length", "narration_mode", "narration_focus"]

# 한 번에 바꾸는 크기. 앱 슬라이더·검사 단계와 같은 단위다.
STEPS = {"contrast": (0.1, 0.5, 2.0), "brightness": (0.1, -1.0, 1.0), "sharpen": (0.2, 0.0, 2.0),
         "edge": (0.2, 0.0, 1.0), "color_severity": (0.2, 0.0, 1.0)}
SPEECH_RATES = [0.75, 1.0, 1.25, 1.5]  # 앱 속도 시트와 같은 값

LABELS = {"color_severity": "색 보정 세기", "contrast": "대비", "brightness": "밝기", "sharpen": "선명도",
          "edge": "윤곽선 강조", "speech_rate": "말하기 속도", "narration_length": "해설 길이",
          "narration_mode": "해설 방식", "narration_focus": "해설 초점"}
# 해설 선호를 바꿀 때 읽어 줄 문장(소리 내어 읽으므로 자연스러운 한 문장).
NARRATION_PHRASES = {
    ("narration_length", "brief"): "다음 해설은 1분 정도로 짧게 들려 드릴게요",
    ("narration_length", "detailed"): "다음 해설은 3분 정도로 자세히 들려 드릴게요",
    ("narration_mode", "facts"): "다음 해설은 사실 위주로 들려 드릴게요",
    ("narration_mode", "interpretations"): "다음 해설은 느낌과 해석 위주로 들려 드릴게요",
    ("narration_mode", "both"): "다음 해설은 사실과 해석을 모두 들려 드릴게요",
    ("narration_focus", "balanced"): "다음 해설은 여러 내용을 골고루 들려 드릴게요",
    ("narration_focus", "color"): "다음 해설은 색을 더 자세히 설명해 드릴게요",
    ("narration_focus", "position"): "다음 해설은 어디에 무엇이 있는지 더 자세히 알려 드릴게요",
    ("narration_focus", "story"): "다음 해설은 그림 속 이야기를 더 자세히 들려 드릴게요",
}


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    artwork_id: str | None = Field(default=None, min_length=1, max_length=80)
    analysis_id: str | None = Field(default=None, min_length=1, max_length=80, description="미등록 감상의 임시 ID. 사진 원본은 저장하지 않음")
    satisfaction: Satisfaction
    comment: str | None = Field(default=None, max_length=500, description="음성을 글자로 바꾼 의견. 없으면 생략")
    apply: bool = Field(default=False, description="true면 제안을 바로 내 프로필에 적용한다(앱 기본)")

    @model_validator(mode="after")
    def one_target(self):
        if (self.artwork_id is None) == (self.analysis_id is None):
            raise ValueError("artwork_id와 analysis_id 중 하나만 지정해야 합니다.")
        return self


class FeedbackSuggestion(BaseModel):
    field: SuggestionField
    label: str
    current: float | str
    proposed: float | str
    message: str = Field(description="화면에 보여 주고 읽어 줄 한 문장")


class FeedbackResult(BaseModel):
    id: str
    artwork_id: str | None
    analysis_id: str | None = None
    satisfaction: Satisfaction
    comment: str | None
    interpreted: bool = Field(description="의견을 AI로 분류했으면 true. 의견이 없거나 AI를 쓸 수 없으면 false")
    suggestions: list[FeedbackSuggestion] = Field(description="apply=true로 적용했으면 바꾼 항목(문장도 '~했어요'), 아니면 제안")
    applied: list[SuggestionField] = []
    profile: VisualProfile | None = Field(default=None, description="바로 적용했을 때 바뀐 프로필")
    message: str
    created_at: str


class FeedbackApply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: list[SuggestionField] = Field(min_length=1, max_length=9)


class FeedbackApplied(BaseModel):
    applied: list[SuggestionField]
    profile: VisualProfile


def _step(value: float, field: str, direction: int) -> float:
    size, low, high = STEPS[field]
    return round(min(high, max(low, value + direction * size)), 2)


# (제안할 때, 적용한 뒤) 문장. 종류가 정해져 있어 앱의 안내 음성을 한 번 만들면 계속 다시 쓴다.
PHRASES = {
    ("color_severity", 1): ("색 보정을 조금 더 강하게 할게요", "색 보정을 조금 더 강하게 했어요"),
    ("color_severity", -1): ("색 보정을 조금 약하게 할게요", "색 보정을 조금 약하게 했어요"),
    ("contrast", 1): ("대비를 조금 높일게요", "대비를 조금 높였어요"),
    ("contrast", -1): ("대비를 조금 낮출게요", "대비를 조금 낮췄어요"),
    ("brightness", 1): ("화면을 조금 밝게 할게요", "화면을 조금 밝게 했어요"),
    ("brightness", -1): ("화면을 조금 어둡게 할게요", "화면을 조금 어둡게 했어요"),
    ("sharpen", 1): ("그림을 조금 더 선명하게 할게요", "그림을 조금 더 선명하게 했어요"),
    ("sharpen", -1): ("선명도를 조금 낮춰 부드럽게 할게요", "선명도를 조금 낮춰 부드럽게 했어요"),
    ("edge", 1): ("윤곽선을 조금 더 진하게 할게요", "윤곽선을 조금 더 진하게 했어요"),
    ("edge", -1): ("윤곽선을 조금 가늘게 할게요", "윤곽선을 조금 가늘게 했어요"),
    ("speech_rate", 1): ("해설을 조금 빠르게 읽을게요", "해설을 조금 빠르게 읽을게요"),
    ("speech_rate", -1): ("해설을 조금 천천히 읽을게요", "해설을 조금 천천히 읽을게요"),
}


def _choice(field, current, proposed, message):
    return FeedbackSuggestion(field=field, label=LABELS[field], current=current, proposed=proposed, message=message)


def _done(item: FeedbackSuggestion) -> FeedbackSuggestion:
    """적용한 뒤 읽을 문장으로 바꾼다."""
    for (field, _), (planned, done) in PHRASES.items():
        if field == item.field and item.message == planned:
            return item.model_copy(update={"message": done})
    return item


def suggestions_for(intent: FeedbackIntent, profile: VisualProfile) -> list[FeedbackSuggestion]:
    """분류 결과를 지금 프로필 기준의 구체적인 값으로 바꾼다. 범위 끝이라 바뀌지 않는 항목은 뺀다."""
    out: list[FeedbackSuggestion] = []

    def numeric(field, current, direction):
        if direction == 0:
            return
        proposed = _step(current, field, direction)
        if proposed != round(current, 2):
            out.append(_choice(field, round(current, 2), proposed, PHRASES[(field, direction)][0]))

    calibration = profile.calibration
    if calibration is not None and calibration.color_type != "normal":
        numeric("color_severity", calibration.severity, {"weaker": -1, "stronger": 1}.get(intent.color, 0))
    numeric("contrast", profile.contrast, {"lower": -1, "higher": 1}.get(intent.contrast, 0))
    numeric("brightness", profile.brightness, {"darker": -1, "brighter": 1}.get(intent.brightness, 0))
    numeric("sharpen", profile.sharpen, {"softer": -1, "sharper": 1}.get(intent.sharpness, 0))
    if calibration is not None:
        numeric("edge", calibration.edge, {"weaker": -1, "stronger": 1}.get(intent.edge, 0))

    direction = {"slower": -1, "faster": 1}.get(intent.speech_rate, 0)
    if direction:
        rate = min(SPEECH_RATES, key=lambda value: abs(value - profile.speech_rate))
        index = SPEECH_RATES.index(rate) + direction
        if 0 <= index < len(SPEECH_RATES) and SPEECH_RATES[index] != profile.speech_rate:
            out.append(_choice("speech_rate", profile.speech_rate, SPEECH_RATES[index], PHRASES[("speech_rate", direction)][0]))

    for field, value in (("narration_length", intent.narration_length), ("narration_mode", intent.narration_mode),
                         ("narration_focus", intent.narration_focus)):
        current = getattr(profile, field)
        if value != "keep" and value != current:
            out.append(_choice(field, current, value, NARRATION_PHRASES[(field, value)]))
    return out


THANKS = "소중한 의견 감사합니다."


def _message(satisfaction: str, comment: str | None, interpreted: bool, suggestions: list, applied: bool = False) -> str:
    """바꾼 설정이 없으면 짧게 감사만 전한다(음성으로 읽으므로 길게 설명하지 않는다)."""
    if suggestions and applied:
        return "말씀하신 대로 바꿨어요. 다음 감상부터 적용돼요."
    if suggestions:
        return "말씀해 주신 내용으로 이렇게 바꿔 볼까요?"
    return THANKS


class FeedbackStore:
    """회원 DB(users.sqlite3)의 feedback 테이블을 쓴다. 테이블은 AccountStore.initialize가 만든다."""

    def __init__(self, accounts):
        self.accounts = accounts

    def add(self, user_id: str, data: FeedbackInput, intent: FeedbackIntent | None, profile: VisualProfile,
            applied: list[str] | None = None):
        """profile은 피드백 당시(적용 전) 설정이다. 바로 적용했으면 applied에 바꾼 항목을 남긴다."""
        row = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
        with closing(self.accounts.connect()) as connection:
            with connection:
                connection.execute(
                    "INSERT INTO feedback (id, user_id, artwork_id, satisfaction, comment, intent_json, profile_json, created_at,"
                    " applied_json, applied_at, analysis_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    # 기존 DB의 NOT NULL 작품 ID는 미등록 감상에서 빈 값으로 유지하고, 실제 식별자는 analysis_id에 분리한다.
                    (row["id"], user_id, data.artwork_id or "", data.satisfaction, data.comment,
                     intent.model_dump_json() if intent else None, profile.model_dump_json(), row["created_at"],
                     json.dumps(applied) if applied else None, row["created_at"] if applied else None, data.analysis_id))
        return row

    def get(self, user_id: str, feedback_id: str):
        with closing(self.accounts.connect()) as connection:
            return connection.execute("SELECT * FROM feedback WHERE id = ? AND user_id = ?", (feedback_id, user_id)).fetchone()

    def claim(self, user_id: str, feedback_id: str, fields: list[str]) -> bool:
        """적용 전에 먼저 표시해 같은 피드백이 동시에 두 번 적용되지 않게 한다."""
        with closing(self.accounts.connect()) as connection:
            with connection:
                return connection.execute(
                    "UPDATE feedback SET applied_json = ?, applied_at = ? WHERE id = ? AND user_id = ? AND applied_at IS NULL",
                    (json.dumps(fields), datetime.now(timezone.utc).isoformat(), feedback_id, user_id)).rowcount > 0

    def release(self, user_id: str, feedback_id: str):
        with closing(self.accounts.connect()) as connection:
            with connection:
                connection.execute("UPDATE feedback SET applied_json = NULL, applied_at = NULL WHERE id = ? AND user_id = ?",
                                   (feedback_id, user_id))


def apply_suggestions(profile: VisualProfile, suggestions: list[FeedbackSuggestion]) -> VisualProfile:
    update: dict = {}
    calibration = profile.calibration
    for item in suggestions:
        if item.field == "color_severity":
            colors = dict(calibration.color_severities) if calibration.color_severities else None
            if colors is not None:
                colors[calibration.color_type] = item.proposed
            calibration = calibration.model_copy(update={"severity": item.proposed, "color_severities": colors})
        elif item.field == "edge":
            calibration = calibration.model_copy(update={"edge": item.proposed})
        else:
            update[item.field] = item.proposed
    if calibration is not profile.calibration:
        update["calibration"] = calibration.model_dump()
    # 검증을 다시 거치도록 dict로 만든다(범위·종류 오류를 저장 전에 막는다).
    return VisualProfile.model_validate({**profile.model_dump(), **update})


def create_feedback_router(accounts, catalog, current_user, gemini):
    router = APIRouter()
    store = FeedbackStore(accounts)
    # AI 분류는 유료 호출이라 사용자당 분당 5회로 제한한다.
    limiter = RateLimiter(attempts=5, window=60)

    @router.post("/me/feedback", response_model=FeedbackResult, status_code=201, tags=["감상 피드백"],
                 summary="감상 만족도와 음성 의견 저장 및 설정 조정 제안",
                 description="의견(comment)이 있으면 AI로 분류해 보정·해설 설정을 한 단계씩 바꾸는 제안을 돌려줍니다. "
                             "artwork_id 또는 미등록 감상의 analysis_id 중 하나를 지정합니다. apply=true면 제안을 바로 적용합니다. "
                             "AI를 쓸 수 없어도 피드백은 저장하고 interpreted=false를 돌려줍니다.")
    async def submit(data: FeedbackInput, user: Annotated[dict, Depends(current_user)]):
        if data.artwork_id is not None and await run_in_threadpool(catalog.get, data.artwork_id) is None:
            raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
        comment = data.comment or None
        data = data.model_copy(update={"comment": comment})
        profile = await run_in_threadpool(accounts.profile, user["id"])
        intent = None
        if comment and hasattr(gemini, "interpret_feedback"):
            limiter.check("user:" + user["id"])
            try:
                intent = await run_in_threadpool(gemini.interpret_feedback, data.satisfaction, comment)
            except HTTPException:
                # 키 없음·한도·연결 실패여도 의견은 남긴다. 제안만 없다.
                intent = None
        suggestions = suggestions_for(intent, profile) if intent else []
        saved, applied = None, []
        if data.apply and suggestions:
            try:
                saved = await run_in_threadpool(accounts.set_profile, user["id"], apply_suggestions(profile, suggestions))
                applied = [item.field for item in suggestions]
                suggestions = [_done(item) for item in suggestions]
            except HTTPException:
                # 그사이 다른 화면에서 프로필이 바뀌었으면 바꾸지 않고 제안만 남긴다(나중에 apply로 적용 가능).
                saved = None
        if data.apply and suggestions and not applied:
            message = "의견은 저장했어요. 설정은 지금 바꾸지 못했어요. 잠시 후 내 보정값에서 바꿀 수 있어요."
        else:
            message = _message(data.satisfaction, comment, intent is not None, suggestions, applied=bool(applied))
        row = await run_in_threadpool(store.add, user["id"], data, intent, profile, applied)
        return {"id": row["id"], "artwork_id": data.artwork_id, "analysis_id": data.analysis_id, "satisfaction": data.satisfaction, "comment": comment,
                "interpreted": intent is not None, "suggestions": suggestions, "applied": applied, "profile": saved,
                "message": message,
                "created_at": row["created_at"]}

    @router.post("/me/feedback/{feedback_id}/apply", response_model=FeedbackApplied, tags=["감상 피드백"],
                 summary="고른 조정 제안을 내 프로필에 적용",
                 description="저장한 분류 결과로 지금 프로필 기준 제안을 다시 계산해, 고른 항목만 한 번 적용합니다. "
                             "같은 피드백은 한 번만 적용할 수 있습니다.")
    def apply(feedback_id: str, data: FeedbackApply, user: Annotated[dict, Depends(current_user)]):
        row = store.get(user["id"], feedback_id)
        if row is None:
            raise HTTPException(404, "피드백을 찾을 수 없습니다.")
        if row["applied_at"] is not None:
            raise HTTPException(409, "이미 적용한 피드백입니다.")
        if row["intent_json"] is None:
            raise HTTPException(409, "적용할 제안이 없습니다.")
        profile = accounts.profile(user["id"])
        chosen = [item for item in suggestions_for(FeedbackIntent.model_validate_json(row["intent_json"]), profile)
                  if item.field in data.fields]
        if not chosen:
            raise HTTPException(409, "바꿀 값이 없습니다. 이미 반영됐거나 설정 범위 끝입니다.")
        fields = [item.field for item in chosen]
        if not store.claim(user["id"], feedback_id, fields):
            raise HTTPException(409, "이미 적용한 피드백입니다.")
        try:
            # profile.revision을 그대로 보내므로 그사이 다른 화면에서 바뀌었으면 409로 막힌다.
            saved = accounts.set_profile(user["id"], apply_suggestions(profile, chosen))
        except Exception:
            store.release(user["id"], feedback_id)
            raise
        return {"applied": fields, "profile": saved}

    return router
