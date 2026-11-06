from typing import Annotated, Literal
from io import BytesIO
from importlib import import_module
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from PIL import Image
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

if __package__:
    from .accounts import RateLimiter
    from .images import MAX_UPLOAD_BYTES, normalize_image
    from .recognition import image_quality
    from .catalog import Description, Coordinate
    from .framing import locate_artwork
    from .ai.profile import AIProfile
else:
    from accounts import RateLimiter
    from images import MAX_UPLOAD_BYTES, normalize_image
    from recognition import image_quality
    from catalog import Description, Coordinate
    from framing import locate_artwork
    from ai.profile import AIProfile


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
    # accounts·current_user는 회원 API 호환을 위해 받지만, 이 라우터의 API는 로그인을 요구하지 않는다.
    router = APIRouter()
    ai_limiter = RateLimiter(attempts=5, window=60)
    photo_limiter = RateLimiter(attempts=60, window=60)
    # 대기열을 만들지 않는다. 정규화·품질 검사·추론·위치 추정 전체에 적용.
    photo_slot = BoundedSemaphore(1)

    @router.post("/correction", tags=["이미지 보정"], summary="등록 원본 또는 촬영본에 AI 프로필 보정 적용",
                 response_class=Response,
                 responses={200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}},
                            503: {"description": "AI 보정 함수 미연결"}})
    async def correction(
        request: Request,
        image: Annotated[UploadFile | None, File()] = None,
        artwork_id: Annotated[str | None, Form()] = None,
        profile: Annotated[str | None, Form(description="6필드 AI 프로필 JSON 문자열. 기기에 저장한 값을 매번 보낸다")] = None,
    ):
        try:
            if (image is None) == (artwork_id is None):
                raise HTTPException(422, "image 또는 artwork_id 중 하나만 보내주세요.")
            if profile is None:
                raise HTTPException(422, "profile을 함께 보내주세요. 프로필은 기기에만 저장합니다.")
            try:
                selected = AIProfile.model_validate_json(profile)
            except ValidationError:
                raise HTTPException(422, "profile은 AI 6필드 규격에 맞는 JSON 객체여야 합니다.") from None
            ai_limiter.check(client_key(request))
            if image is not None:
                normalized = await read_upload(image)
            else:
                record = await run_in_threadpool(catalog.get, artwork_id)
                if record is None:
                    raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
                content = await run_in_threadpool((catalog.images_dir / record["image_filename"]).read_bytes)
                normalized = await run_in_threadpool(normalize_image, content)
            result = await run_in_threadpool(correct_jpeg, normalized.content, selected, corrector)
            return Response(result, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
        finally:
            if image is not None:
                await image.close()

    @router.post("/recognize", response_model=RecognitionResult, tags=["작품 인식"], summary="촬영 사진·명패로 작품 후보 상위 3개 조회",
                 description="로그인 불필요(앱은 기기 로컬 저장만 사용). 호출 제한은 접속 IP 기준입니다. mode=artwork는 CLIP 코사인 유사도, placard는 명패 텍스트 매칭 점수입니다. 점수는 확률이 아닙니다. confidence로 화면을 분기합니다. 기준 미설정 시 후보는 medium입니다. 사진은 저장하지 않습니다.")
    async def recognize(
        request: Request,
        image: Annotated[UploadFile, File(description="작품 또는 명패 사진")],
        mode: Annotated[Literal["artwork", "placard"], Form()] = "artwork",
    ):
        key = client_key(request)
        acquired = False
        try:
            if mode == "artwork":
                photo_limiter.check(key)
                acquired = photo_slot.acquire(blocking=False)
                if not acquired:
                    raise HTTPException(503, "작품 인식이 처리 중입니다. 잠시 후 다시 시도해 주세요.",
                                        headers={"Retry-After": "2"})
            else:
                ai_limiter.check(key)
            normalized = await read_upload(image)
            quality =await run_in_threadpool(image_quality, normalized.content)
            if mode == "artwork":
                candidates = await run_in_threadpool(recognition.recognize_artwork, normalized.content)
                score_type = "cosine_similarity"
            else:
                extracted = await run_in_threadpool(gemini.read_placard, normalized.content)
                candidates = await run_in_threadpool(recognition.match_placard, extracted.title, extracted.artist, extracted.text)
                score_type = "fuzzy_text_similarity"
            threshold = getattr(recognition, "match_threshold", None) if mode == "artwork" else None
            if threshold is not None and candidates and max(candidate["score"] for candidate in candidates) < threshold:
                candidates = []
            confidence = "medium" if candidates else "low"
            high_threshold = getattr(recognition, "high_confidence_threshold", None) if mode == "artwork" else None
            if candidates and threshold is not None and high_threshold is not None and candidates[0]["score"] >= high_threshold:
                confidence = "high"
            for i, candidate in enumerate(candidates):
                record = await run_in_threadpool(catalog.get, candidate["artwork_id"])
                if record is None:
                    raise HTTPException(503, "작품 목록이 변경됐습니다. 인덱스를 다시 생성해 주세요.")
                candidate["image_url"] = str(request.url_for("artwork-images", path=record["image_filename"]))
                if mode == "artwork" and i == 0:
                    reference = await run_in_threadpool((catalog.images_dir / record["image_filename"]).read_bytes)
                    location = await run_in_threadpool(locate_artwork, normalized.content, reference)
                    if location is not None:
                        quality.update(location)
            return {"mode": mode, "candidates": candidates, "score_type": score_type,
                    "status": "matched" if confidence == "high" else ("needs_confirmation" if candidates else "no_match"),
                    "confidence": confidence, "quality": quality, "match_threshold": threshold}
        finally:
            if acquired:
                photo_slot.release()
            await image.close()

    @router.post("/analyze", response_model=AnalysisResult, tags=["작품 해설"], summary="미등록 작품의 실시간 한국어 해설 생성",
                 description="로그인 불필요. 호출 제한은 접속 IP 기준(분당 5회). Gemini로 사실·감정 해석·영역·분위기 키워드를 생성합니다. 미검수 결과임을 표시하고 사진과 결과는 DB에 저장하지 않습니다.")
    async def analyze(request: Request, image: Annotated[UploadFile, File()]):
        ai_limiter.check(client_key(request))
        normalized = await read_upload(image)
        description = await run_in_threadpool(gemini.describe, normalized.content)
        return {"description": description.model_dump(), "review_status": "unreviewed",
                "fallback": getattr(description, "fallback", False),
                "warning": "AI가 생성한 미검수 해설로 사실과 다른 내용이 포함될 수 있습니다."}

    @router.get("/artworks/{artwork_id}/narration", response_model=NarrationResult, tags=["작품 해설"], summary="감상 모드에 맞는 검수 해설 텍스트 조회",
                description="로그인 불필요. mode는 기기에 저장한 감상 모드를 보내며 생략 시 both입니다. 반환된 text를 앱의 expo-speech로 재생합니다.")
    def narration(artwork_id: str,
                  mode: Annotated[Literal["facts", "interpretations", "both"], Query()] = "both"):
        record = catalog.get(artwork_id)
        if record is None:
            raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
        if record["description"] is None:
            raise HTTPException(409, "검수된 해설이 아직 없습니다.")
        selected = mode
        description = record["description"]
        segments = []
        if selected in {"facts", "both"}:
            indices = description.get("fact_region_indices") or [None] * len(description["facts"])
            segments.extend({"type": "fact", "text": text, "region_index": index}
                            for text, index in zip(description["facts"], indices))
        if selected in {"interpretations", "both"}:
            indices = description.get("interpretation_region_indices") or [None] * len(description["interpretations"])
            segments.extend({"type": "interpretation", "text": "가능한 감정적 해석입니다. " + text, "region_index": index}
                            for text, index in zip(description["interpretations"], indices))
        return {"artwork_id": artwork_id, "mode": selected, "segments": segments,
                "text": "\n".join(segment["text"] for segment in segments), "review_status": "reviewed"}

    return router
