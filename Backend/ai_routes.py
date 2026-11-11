import asyncio
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Annotated, Literal
from io import BytesIO
from importlib import import_module
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from PIL import Image
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

if __package__:
    from .generated_cache import GeneratedCache
    from .accounts import RateLimiter
    from .images import MAX_UPLOAD_BYTES, normalize_image
    from .recognition import image_quality
    from .catalog import Description, Coordinate
    from .framing import locate_artwork
    from .ai.profile import AIProfile
    from .ai.decision import decide
else:
    from generated_cache import GeneratedCache
    from accounts import RateLimiter
    from images import MAX_UPLOAD_BYTES, normalize_image
    from recognition import image_quality
    from catalog import Description, Coordinate
    from framing import locate_artwork
    from ai.profile import AIProfile
    from ai.decision import decide


class RecognitionCandidate(BaseModel):
    artwork_id: str
    title: str
    artist: str
    score: float = Field(ge=-1, le=1, description="유사도 점수. 확률이나 정확도 백분율이 아닙니다.")
    image_url: str


class QualityResult(BaseModel):
    laplacian_variance: float
    highlight_ratio: float
    warnings: list[str]
    note: str
    artwork_bbox: tuple[Coordinate, Coordinate, Coordinate, Coordinate] | None = None
    framing_hint: Literal["move_left", "move_right", "move_up", "move_down", "move_closer", "move_back", "hold_still"] | None = None


class RecognitionResult(BaseModel):
    mode: Literal["artwork", "placard"]
    candidates: list[RecognitionCandidate]
    score_type: Literal["cosine_similarity", "fuzzy_text_similarity"]
    status: Literal["matched", "needs_confirmation", "no_match"]
    confidence: Literal["high", "medium", "low"]
    quality: QualityResult
    match_threshold: float | None = None
    reason: Literal["matched", "low_confidence", "unregistered_artwork", "not_artwork", "placard_unreadable"] = Field(
        description="결과가 나온 이유. unregistered_artwork=작품 사진이지만 미등록, not_artwork=작품이 아닌 사진")
    next_action: Literal["show_artwork", "confirm_candidates", "analyze", "retake"] = Field(
        description="앱이 다음에 할 일. analyze면 같은 사진으로 /analyze를 호출하고, retake면 다시 촬영을 안내합니다.")
    message: str = Field(description="사용자에게 화면·음성으로 그대로 안내할 문장")
    artwork_probability: float | None = Field(default=None, ge=0, le=1,
        description="작품을 찍은 사진일 확률(CLIP 제로샷). 판별을 끈 경우 null")


class AnalysisResult(BaseModel):
    description: Description
    review_status: Literal["unreviewed"]
    warning: str
    fallback: bool = False


class NarrationSegment(BaseModel):
    region_index: int | None = Field(default=None, ge=0)
    type: Literal["fact", "interpretation"]
    text: str


class NarrationResult(BaseModel):
    artwork_id: str
    mode: Literal["facts", "interpretations", "both"]
    segments: list[NarrationSegment]
    text: str
    review_status: Literal["reviewed"]


class NarrationSource(BaseModel):
    no: int
    title: str = ""
    url: str


class GeneratedNarrationResult(AnalysisResult):
    artwork_id: str
    mode: Literal["both"] = "both"
    segments: list[NarrationSegment]
    text: str
    length: Literal["brief", "detailed"] = Field(default="brief", description="brief=약 1분, detailed=약 3분 미술사 해설")
    estimated_seconds: int | None = Field(default=None, description="공백 제외 글자 수 ÷ 5.5")
    sources: list[NarrationSource] = Field(default=[], description="상세 해설의 근거 출처(구글 검색 근거 또는 검수 파일)")



AI_WARNING = "AI 생성 해설입니다."

# 지침대로 사람이 조사·검수한 상세 해설. 있으면 생성보다 우선한다.
LONG_COMMENTARY_DIR = Path(__file__).resolve().parent.parent / "content" / "long-commentary"
EMPTY_DESCRIPTION = {"facts": [], "interpretations": [], "regions": [], "mood_keywords": []}


def sentences(text: str) -> list[str]:
    """플레이어는 한 문장씩 읽으므로 문장 끝에서 나눈다."""
    return [part.strip() for part in re.split(r"(?<=[.?!])\s+", text.strip()) if part.strip()]


def long_segments(sections: list[dict]) -> list[dict]:
    return [{"type": section["type"], "text": sentence, "region_index": None}
            for section in sections for sentence in sentences(section["text"])]


def spoken_seconds(text: str) -> int:
    return round(len(re.sub(r"\s", "", text)) / 5.5)


def narration_key(length: str, model: str, record: dict, content: bytes) -> str:
    """API와 일괄 생성 스크립트가 같은 저장소 키를 쓴다. 프롬프트·형식을 바꾸면 버전을 올린다."""
    return sha256(json.dumps(["narration-v2", length, model, record, sha256(content).hexdigest()],
                             sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def make_narration(gemini, artwork_id: str, record: dict, content: bytes, length: str) -> dict:
    """작품 원본으로 간결(약 1분)·상세(약 3분) 해설을 만든다. 저장은 호출한 쪽이 한다."""
    normalized = normalize_image(content)
    if length == "detailed":
        long = gemini.long_commentary(normalized.content, record)
        segments = long_segments(long["sections"])
        return {"artwork_id": artwork_id, "mode": "both", "description": EMPTY_DESCRIPTION, "segments": segments,
                "text": "\n".join(segment["text"] for segment in segments), "review_status": "unreviewed",
                "fallback": not segments, "warning": AI_WARNING, "length": "detailed",
                "estimated_seconds": long["estimated_seconds"], "sources": long["sources"]}
    description = gemini.describe(normalized.content, record, True)
    fallback = getattr(description, "fallback", False)
    segments = [] if fallback else narration_segments(description.model_dump())
    text = "\n".join(segment["text"] for segment in segments)
    return {"artwork_id": artwork_id, "mode": "both", "description": description.model_dump(),
            "segments": segments, "text": text, "review_status": "unreviewed", "fallback": fallback,
            "warning": AI_WARNING, "length": "brief", "estimated_seconds": spoken_seconds(text), "sources": []}


def narration_segments(description: dict, mode: str = "both") -> list[dict]:
    segments = []
    if mode in {"facts", "both"}:
        indices = description.get("fact_region_indices") or [None] * len(description["facts"])
        segments.extend({"type": "fact", "text": text, "region_index": index}
                        for text, index in zip(description["facts"], indices))
    if mode in {"interpretations", "both"}:
        indices = description.get("interpretation_region_indices") or [None] * len(description["interpretations"])
        segments.extend({"type": "interpretation", "text": "가능한 감정적 해석입니다. " + text, "region_index": index}
                        for text, index in zip(description["interpretations"], indices))
    return segments


async def read_upload(image: UploadFile):
    try:
        if image.size is not None and image.size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "이미지는 10MB 이하여야 합니다.")
        content = await image.read(MAX_UPLOAD_BYTES + 1)
        if not content:
            raise HTTPException(400, "빈 파일입니다.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "이미지는 10MB 이하여야 합니다.")
        return await run_in_threadpool(normalize_image, content)
    finally:
        await image.close()


def correct_jpeg(content: bytes, profile: AIProfile, corrector=None):
    if corrector is None:
        module_name = f"{__package__}.ai.correction" if __package__ else "ai.correction"
        try:
            corrector = import_module(module_name).correct_image
        except (ImportError, AttributeError):
            raise HTTPException(503, "AI 보정 함수가 아직 연결되지 않았습니다. Backend/ai/correction.py의 correct_image를 구현해 주세요.") from None
    # AI 함수 계약: RGB JPEG bytes + dict -> 동일 크기의 JPEG bytes.
    result = corrector(content, profile.model_dump())
    if not isinstance(result, bytes):
        raise HTTPException(502, "AI 보정 함수는 JPEG bytes를 반환해야 합니다.")
    try:
        with Image.open(BytesIO(content)) as original, Image.open(BytesIO(result)) as corrected:
            if corrected.format != "JPEG" or corrected.size != original.size:
                raise ValueError("JPEG format or dimensions mismatch")
            corrected.verify()
        # AI가 넣은 EXIF/GPS를 제거하고 실제 디코딩까지 확인한다.
        return normalize_image(result).content
    except (OSError, ValueError, SyntaxError):
        raise HTTPException(502, "AI 보정 결과는 입력과 같은 크기의 정상 JPEG여야 합니다.") from None


def client_key(request: Request) -> str:
    """앱은 로그인 없이 기기 로컬 저장만 쓰므로, 호출 제한은 계정 대신 접속 IP로 건다."""
    return "ip:" + (request.client.host if request.client else "unknown")


def create_ai_router(catalog, accounts, current_user, recognition, gemini, corrector=None):
    # 개인 보정은 인증된 계정의 DB 설정만 사용한다. 인식·해설 API의 인증 정책은 유지한다.
    router = APIRouter()
    narration_cache = GeneratedCache(catalog.data_dir)
    pending_narrations = {}
    ai_limiter = RateLimiter(attempts=5, window=60)
    photo_limiter = RateLimiter(attempts=60, window=60)
    # 색 보정은 서버 안의 이미지 처리(유료 AI 호출 아님)라 AI 해설 한도(분당 5회)와 따로 센다.
    # 작품을 넘길 때마다 요청하므로 넉넉하게 둔다.
    correction_limiter = RateLimiter(attempts=120, window=60)
    # 대기열을 만들지 않는다. 정규화·품질 검사·추론·위치 추정 전체에 적용.
    photo_slot = BoundedSemaphore(1)

    @router.post("/correction", tags=["이미지 보정"], summary="등록 원본 또는 촬영본에 AI 프로필 보정 적용",
                 response_class=Response,
                 responses={200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}},
                            503: {"description": "AI 보정 함수 미연결"}})
    async def correction(
        request: Request,
        user: Annotated[dict, Depends(current_user)],
        image: Annotated[UploadFile | None, File()] = None,
        artwork_id: Annotated[str | None, Form()] = None,
        strength: Annotated[float, Form(ge=0, le=1, description="DB 보정값의 적용 비율. 1도 저장 강도를 초과하지 않는다")] = 1,
        profile_revision: Annotated[str | None, Form(min_length=64, max_length=64)] = None,
        profile: Annotated[str | None, Form(description="사용 불가: 개인 보정값은 DB에서만 조회한다")] = None,
    ):
        try:
            if (image is None) == (artwork_id is None):
                raise HTTPException(422, "image 또는 artwork_id 중 하나만 보내주세요.")
            if profile is not None:
                raise HTTPException(422, "profile은 보낼 수 없습니다. 계정에 저장한 보정값만 사용합니다.")
            viewing, saved = await run_in_threadpool(accounts.correction_profile, user["id"])
            if saved is None:
                raise HTTPException(409, "먼저 개인 보정값을 저장해 주세요.")
            if profile_revision is not None and profile_revision != viewing.revision:
                raise HTTPException(409, "보정값이 변경되었습니다. 다시 불러와 주세요.")
            # 대비·밝기·선명도는 DB에서 읽은 앱 설정으로 Skia가 한 번만 처리한다.
            selected = saved.model_copy(update={
                "severity": saved.severity * strength if saved.color_type != "normal" else 0,
                "edge": saved.edge * strength, "contrast": 1, "brightness": 0, "sharpness": 0,
            })
            correction_limiter.check(client_key(request))
            if image is not None:
                normalized = await read_upload(image)
            else:
                record = await run_in_threadpool(catalog.get, artwork_id)
                if record is None:
                    raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
                content = await run_in_threadpool((catalog.images_dir / record["image_filename"]).read_bytes)
                normalized = await run_in_threadpool(normalize_image, content)
            result = await run_in_threadpool(correct_jpeg, normalized.content, selected, corrector)
            return Response(result, media_type="image/jpeg", headers={
                "Cache-Control": "no-store", "X-Correction-Profile-Revision": viewing.revision,
            })
        finally:
            if image is not None:
                await image.close()

    async def attach_images(request, candidates, content=None, quality=None):
        """후보에 원본 이미지 주소를 붙이고, 작품 사진이면 1순위 작품의 위치(촬영 안내)를 추정한다."""
        for i, candidate in enumerate(candidates):
            record = await run_in_threadpool(catalog.get, candidate["artwork_id"])
            if record is None:
                raise HTTPException(503, "작품 목록이 변경됐습니다. 인덱스를 다시 생성해 주세요.")
            candidate["image_url"] = str(request.url_for("artwork-images", path=record["image_filename"]))
            if content is not None and i == 0:
                reference = await run_in_threadpool((catalog.images_dir / record["image_filename"]).read_bytes)
                location = await run_in_threadpool(locate_artwork, content, reference)
                if location is not None:
                    quality.update(location)

    async def recognize_artwork_photo(request: Request, image: UploadFile):
        key = client_key(request)
        acquired = False
        try:
            photo_limiter.check(key)
            acquired = photo_slot.acquire(blocking=False)
            if not acquired:
                raise HTTPException(503, "작품 인식이 처리 중입니다. 잠시 후 다시 시도해 주세요.",
                                    headers={"Retry-After": "2"})
            normalized = await read_upload(image)
            quality = await run_in_threadpool(image_quality, normalized.content)
            if hasattr(recognition, "recognize_photo"):
                found = await run_in_threadpool(recognition.recognize_photo, normalized.content)
            else:
                found = {"candidates": await run_in_threadpool(recognition.recognize_artwork, normalized.content),
                         "artwork_probability": None}
            candidates, probability = found["candidates"], found["artwork_probability"]
            threshold = getattr(recognition, "match_threshold", None)
            outcome = decide([candidate["score"] for candidate in candidates], match_threshold=threshold,
                             high_threshold=getattr(recognition, "high_confidence_threshold", None),
                             artwork_probability=probability,
                             gate_threshold=getattr(recognition, "gate_threshold", None),
                             quality_warnings=quality["warnings"])
            if not outcome.pop("keep_candidates"):
                candidates = []
            await attach_images(request, candidates, normalized.content, quality)
            return {"mode": "artwork", "candidates": candidates, "score_type": "cosine_similarity",
                    "quality": quality, "match_threshold": threshold, "artwork_probability": probability, **outcome}
        finally:
            if acquired:
                photo_slot.release()
            await image.close()

    async def recognize_placard_photo(request: Request, image: UploadFile):
        try:
            ai_limiter.check(client_key(request))
            normalized = await read_upload(image)
            quality = await run_in_threadpool(image_quality, normalized.content)
            extracted = await run_in_threadpool(gemini.read_placard, normalized.content)
            candidates = await run_in_threadpool(recognition.match_placard, extracted.title, extracted.artist, extracted.text)
            await attach_images(request, candidates)
            if candidates:
                outcome = {"status": "needs_confirmation", "confidence": "medium", "reason": "low_confidence",
                           "next_action": "confirm_candidates", "message": "명패와 비슷한 작품을 찾았어요. 맞는 작품을 골라 주세요."}
            else:
                outcome = {"status": "no_match", "confidence": "low", "reason": "placard_unreadable", "next_action": "retake",
                           "message": "명패를 읽지 못했어요. 명패 글자가 화면에 크고 선명하게 나오도록 다시 찍어 주세요."}
            return {"mode": "placard", "candidates": candidates, "score_type": "fuzzy_text_similarity",
                    "quality": quality, "match_threshold": None, **outcome}
        finally:
            await image.close()

    @router.post("/recognize/artwork", response_model=RecognitionResult, tags=["작품 인식"],
                 summary="작품 사진으로 등록 작품 찾기 (CLIP)",
                 description="로그인 불필요. 호출 제한은 접속 IP 기준입니다. 작품 사진만 처리합니다. "
                             "next_action으로 화면을 분기합니다: show_artwork(바로 이동), confirm_candidates(후보 확인), "
                             "analyze(미등록 작품 → 같은 사진으로 /analyze 호출), retake(작품이 아닌 사진 → 다시 촬영). "
                             "message는 사용자에게 그대로 안내할 문장입니다. 점수는 확률이 아닙니다. 사진은 저장하지 않습니다.")
    async def recognize_artwork(request: Request, image: Annotated[UploadFile, File(description="작품 사진")]):
        return await recognize_artwork_photo(request, image)

    @router.post("/recognize/placard", response_model=RecognitionResult, tags=["작품 인식"],
                 summary="명패 사진으로 등록 작품 찾기 (Gemini 글자 읽기)",
                 description="로그인 불필요. 호출 제한은 접속 IP 기준(분당 5회)입니다. 명패 사진만 처리합니다. "
                             "글자를 읽지 못하면 next_action=retake입니다. 사진은 저장하지 않습니다.")
    async def recognize_placard(request: Request, image: Annotated[UploadFile, File(description="명패 사진")]):
        return await recognize_placard_photo(request, image)

    @router.post("/recognize", response_model=RecognitionResult, tags=["작품 인식"], deprecated=True,
                 summary="(이전 버전) 작품·명패 인식",
                 description="앱 호환을 위해 남겨 둔 이전 API입니다. 새 코드는 /recognize/artwork 또는 /recognize/placard를 사용하세요.")
    async def recognize(
        request: Request,
        image: Annotated[UploadFile, File(description="작품 또는 명패 사진")],
        mode: Annotated[Literal["artwork", "placard"], Form()] = "artwork",
    ):
        if mode == "artwork":
            return await recognize_artwork_photo(request, image)
        return await recognize_placard_photo(request, image)

    @router.post("/analyze", response_model=AnalysisResult, tags=["작품 해설"], summary="미등록 작품의 실시간 한국어 해설 생성",
                 description="로그인 불필요. 호출 제한은 접속 IP 기준(분당 5회). Gemini로 사실·감정 해석·영역·분위기 키워드를 생성합니다. 미검수 결과임을 표시하고 사진과 결과는 DB에 저장하지 않습니다.")
    async def analyze(request: Request, image: Annotated[UploadFile, File()]):
        ai_limiter.check(client_key(request))
        normalized = await read_upload(image)
        description = await run_in_threadpool(gemini.describe, normalized.content)
        return {"description": description.model_dump(), "review_status": "unreviewed",
                "fallback": getattr(description, "fallback", False),
                "warning": AI_WARNING}

    @router.post("/artworks/{artwork_id}/narration", response_model=GeneratedNarrationResult,
                 tags=["작품 해설"], summary="등록 작품의 AI 해설 생성 (미검수)",
                 description="등록 원본과 카탈로그 메타데이터로 Gemini 해설을 생성합니다. 검수 완료로 저장하지 않습니다. "
                             "성공한 해설은 SQLite에 저장하고 같은 작품 요청에 재사용합니다. 생성 시 AI 호출 제한·예산을 적용합니다. fallback은 저장하지 않습니다.")
    async def generate_narration(request: Request, response: Response, artwork_id: str,
                                 length: Annotated[Literal["brief", "detailed"], Query(
                                     description="brief=간결하게(약 1분), detailed=상세하게(약 3분)")] = "brief"):
        response.headers["Cache-Control"] = "no-store"
        record = await run_in_threadpool(catalog.get, artwork_id)
        if record is None:
            raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
        curated = LONG_COMMENTARY_DIR / f"{artwork_id}.json"
        if length == "detailed" and curated.is_file():
            data = json.loads(await run_in_threadpool(curated.read_text, "utf-8"))
            segments = long_segments(data["sections"])
            text = "\n".join(segment["text"] for segment in segments)
            return {"artwork_id": artwork_id, "mode": "both", "description": EMPTY_DESCRIPTION, "segments": segments,
                    "text": text, "review_status": "unreviewed", "fallback": False, "warning": AI_WARNING,
                    "length": "detailed", "estimated_seconds": data.get("estimated_seconds") or spoken_seconds(text),
                    "sources": [{"no": s["no"], "title": s.get("title", ""), "url": s["url"]} for s in data.get("sources", [])]}
        content = await run_in_threadpool((catalog.images_dir / record["image_filename"]).read_bytes)
        key = narration_key(length, getattr(gemini, "model", ""), record, content)
        stored = await run_in_threadpool(narration_cache.get, "narration", key)
        if stored is not None:
            # Older saved results carry an older notice; always show the current one.
            return {**json.loads(stored), "warning": AI_WARNING}

        async def generate_and_store():
            ai_limiter.check(client_key(request))
            result = await run_in_threadpool(make_narration, gemini, artwork_id, record, content, length)
            fallback, segments = result["fallback"], result["segments"]
            if not fallback and segments:
                await run_in_threadpool(narration_cache.put, "narration", key,
                                        json.dumps(result, ensure_ascii=False).encode())
            return result

        if key not in pending_narrations:
            task = asyncio.create_task(generate_and_store())
            pending_narrations[key] = task

            def complete(done):
                if pending_narrations.get(key) is done:
                    del pending_narrations[key]
                if not done.cancelled():
                    done.exception()  # Observe failures even if every HTTP client disconnected.

            task.add_done_callback(complete)
        return await asyncio.shield(pending_narrations[key])

    @router.get("/artworks/{artwork_id}/narration", response_model=NarrationResult, tags=["작품 해설"], summary="감상 모드에 맞는 검수 해설 텍스트 조회",
                description="로그인 불필요. mode는 기기에 저장한 감상 모드를 보내며 생략 시 both입니다. 반환된 text를 앱의 expo-speech로 재생합니다.")
    def narration(artwork_id: str,
                  mode: Annotated[Literal["facts", "interpretations", "both"], Query()] = "both"):
        record = catalog.get(artwork_id)
        if record is None:
            raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
        if record["description"] is None:
            raise HTTPException(409, "검수된 해설이 아직 없습니다.")
        segments = narration_segments(record["description"], mode)
        return {"artwork_id": artwork_id, "mode": mode, "segments": segments,
                "text": "\n".join(segment["text"] for segment in segments), "review_status": "reviewed"}

    return router
