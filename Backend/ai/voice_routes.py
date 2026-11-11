"""보기 설정 테스트(화면 맞추기)의 음성 답변 기록 API.

- POST   /calibration/voice-answers               : 음성 답변 1개의 결과(인식된 글자·고른 보기)를 저장
- GET    /calibration/voice-answers/{session_id}  : 한 테스트 회차의 기록 조회
- DELETE /calibration/voice-answers/{session_id}  : 한 테스트 회차의 기록 삭제

로그인은 필요 없다. 앱이 화면 맞추기를 시작할 때 만든 임의의 session_id로 한 회차의 답변을 묶는다.
음성 원본은 받지 않는다(글자 변환은 /transcribe, 보기 맞추기는 앱에서 한다).
"""
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path as PathParam, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Backend.ai.voice_routes(패키지 실행)이면 ..accounts, Backend 폴더에서 ai.voice_routes로 실행하면 accounts
if __package__ and "." in __package__:
    from ..accounts import RateLimiter
else:
    from accounts import RateLimiter

SESSION_PATTERN = r"^[A-Za-z0-9-]{8,64}$"
Step = Literal["screening", "color", "edge", "contrast"]


class VoiceAnswerInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    session_id: str = Field(pattern=SESSION_PATTERN, description="앱이 화면 맞추기를 시작할 때 만든 임의 ID")
    step: Step
    item: str | None = Field(default=None, max_length=120, description="보여 준 검사판·그림을 구분하는 값")
    choices: list[str] = Field(min_length=2, max_length=4, description="화면의 보기")
    transcript: str = Field(max_length=500, description="/transcribe가 돌려준 글자")
    choice: str | None = Field(default=None, description="앱이 맞춘 보기. 못 맞췄으면 null")
    expected: str | None = Field(default=None, description="검사판의 정답(answer)")

    @field_validator("choices")
    @classmethod
    def check_choices(cls, choices):
        choices = [choice.strip() for choice in choices]
        if not all(0 < len(choice) <= 30 for choice in choices) or len(set(choices)) != len(choices):
            raise ValueError("choices는 서로 다른 1~30자 보기 2~4개여야 합니다.")
        return choices

    @model_validator(mode="after")
    def check_in_choices(self):
        for name in ("choice", "expected"):
            value = getattr(self, name)
            if value is not None and value not in self.choices:
                raise ValueError(f"{name}는 choices 중 하나여야 합니다.")
        return self


class VoiceAnswerRecord(BaseModel):
    id: str
    session_id: str
    step: str
    item: str | None
    choices: list[str]
    transcript: str
    choice: str | None
    expected: str | None
    is_correct: bool | None
    created_at: float


class VoiceAnswerList(BaseModel):
    session_id: str
    items: list[VoiceAnswerRecord]


def create_voice_router(store, client_key):
    router = APIRouter(prefix="/calibration", tags=["화면 맞추기 음성 답변"])
    limiter = RateLimiter(attempts=60, window=60)

    @router.post("/voice-answers", response_model=VoiceAnswerRecord, status_code=201, summary="음성 답변 결과 저장",
                 description="화면 맞추기에서 말로 답한 결과(인식된 글자, 앱이 맞춘 보기, 정답)를 저장합니다. "
                             "음성 원본은 받지 않습니다. 정답(expected)을 보내면 is_correct를 함께 저장합니다.")
    async def save_voice_answer(request: Request, response: Response, data: VoiceAnswerInput):
        response.headers["Cache-Control"] = "no-store"
        limiter.check(client_key(request))
        return await run_in_threadpool(lambda: store.add(**data.model_dump()))

    @router.get("/voice-answers/{session_id}", response_model=VoiceAnswerList, summary="한 회차의 음성 답변 기록 조회")
    def voice_answers(request: Request, response: Response,
                      session_id: Annotated[str, PathParam(pattern=SESSION_PATTERN)]):
        response.headers["Cache-Control"] = "no-store"
        limiter.check(client_key(request))
        return {"session_id": session_id, "items": store.session(session_id)}

    @router.delete("/voice-answers/{session_id}", summary="한 회차의 음성 답변 기록 삭제")
    def delete_voice_answers(request: Request, session_id: Annotated[str, PathParam(pattern=SESSION_PATTERN)]):
        limiter.check(client_key(request))
        deleted = store.delete_session(session_id)
        if not deleted:
            raise HTTPException(404, "해당 회차의 기록이 없습니다.")
        return {"session_id": session_id, "deleted": deleted}

    return router
