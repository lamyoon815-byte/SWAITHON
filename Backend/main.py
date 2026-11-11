from contextlib import asynccontextmanager
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi import Path as PathParameter
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

if __package__:
    from .catalog import ArtworkDetail, ArtworkList, CatalogStore, MuseumList
    from .images import normalize_image, upload_image
    from .accounts import AccountStore, create_account_router
    from .recognition import RecognitionService
    from .gemini import GeminiService
    from .ai_routes import create_ai_router
    from .ai.budget import GeminiBudget
    from .speech import OpenAISpeechService, create_speech_router
    from .ai.transcription import OpenAITranscriptionService, create_transcription_router
    from .ai.voice_routes import create_voice_router
    from .ai.voice_answer import VoiceAnswerStore
    from .ai_routes import client_key
else:
    from catalog import ArtworkDetail, ArtworkList, CatalogStore, MuseumList
    from images import normalize_image, upload_image
    from accounts import AccountStore, create_account_router
    from recognition import RecognitionService
    from gemini import GeminiService
    from ai_routes import create_ai_router
    from ai.budget import GeminiBudget
    from speech import OpenAISpeechService, create_speech_router
    from ai.transcription import OpenAITranscriptionService, create_transcription_router
    from ai.voice_routes import create_voice_router
    from ai.voice_answer import VoiceAnswerStore
    from ai_routes import client_key

load_dotenv(Path(__file__).with_name(".env"))


def health_check():
    return {"status": "ok"}


def create_app(data_dir: Path | None = None, *, recognition=None, gemini=None, corrector=None) -> FastAPI:
    store = CatalogStore(data_dir)
    accounts = AccountStore(store.data_dir)
    recognition = recognition if recognition is not None else RecognitionService(store)
    gemini = gemini if gemini is not None else GeminiService()
    if isinstance(gemini, GeminiService) and gemini.budget is None:
        # 유료 API 예산 상한(기본 12,000원). 사용 내역은 data/gemini-usage.json에 기록한다.
        gemini.budget = GeminiBudget(store.data_dir / "gemini-usage.json")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        await run_in_threadpool(store.initialize)
        await run_in_threadpool(accounts.initialize)
        # 시연용: CLIP_WARMUP=1이면 서버 시작 때 모델·인덱스를 미리 불러 첫 인식도 빠르게 한다.
        if os.environ.get("CLIP_WARMUP", "").strip().lower() in {"1", "true", "on"} and hasattr(recognition, "warmup"):
            await run_in_threadpool(recognition.warmup)
        yield

    application = FastAPI(
        title="MoMi API",
        description=(
            "작품 사진 업로드와 등록 작품 조회를 제공하는 백엔드 API입니다.\n\n"
            "작품 조회 결과의 `image_url`을 열면 등록된 원본 이미지를 볼 수 있습니다. "
            "원본 이미지는 `/images/{filename}`에서 제공됩니다."
        ),
        openapi_tags=[
            {"name": "서버 상태", "description": "서버가 정상적으로 응답하는지 확인합니다."},
            {"name": "사진 업로드", "description": "사용자 촬영 사진의 검증과 전처리를 확인합니다."},
            {"name": "작품 조회", "description": "SQLite에 등록된 작품 정보·해설·원본 이미지 URL을 조회합니다."},
            {"name": "회원 인증", "description": "이메일 회원가입·로그인·로그아웃. 발급된 access_token을 Authorize에 입력하세요. 세션 유효기간은 7일입니다."},
            {"name": "시각 프로필", "description": "계정별 보정 설정을 저장합니다. 앱이 이 설정을 받아 실시간 보정합니다."},
            {"name": "관람 기록", "description": "회원 본인의 작품 감상 기록과 당시 보정 설정을 관리합니다."},
            {"name": "작품 인식", "description": "CLIP 작품 검색 또는 Gemini 명패 읽기와 카탈로그 매칭을 수행합니다."},
            {"name": "작품 해설", "description": "검수된 등록 작품 해설과 미등록 작품 실시간 분석을 제공합니다."},
        ],
        lifespan=lifespan,
    )
    application.state.accounts = accounts
    application.state.catalog = store
    application.state.recognition = recognition
    application.state.speech = OpenAISpeechService(store.data_dir)
    application.include_router(create_speech_router(application.state.speech))
    application.state.transcription = OpenAITranscriptionService(store.data_dir)
    application.include_router(create_transcription_router(application.state.transcription, store))
    origins = [item.strip() for item in os.environ.get("CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081").split(",") if item.strip()]
    if origins:
        application.add_middleware(CORSMiddleware, allow_origins=origins,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"], expose_headers=["Retry-After", "X-Voice-Cache-Key", "X-Correction-Profile-Revision"])

    @application.middleware("http")
    async def private_cache_control(request: Request, call_next):
        response = await call_next(request)
        if request.headers.get("authorization") or request.url.path.startswith(("/me", "/auth", "/analyze", "/recognize", "/correction")):
            response.headers["Cache-Control"] = "no-store"
        return response

    account_router, current_user = create_account_router(accounts, store)
    application.include_router(account_router)
    application.include_router(create_ai_router(store, accounts, current_user, recognition, gemini, corrector))
    # 화면 맞추기 음성 답변 기록(인식된 글자·고른 보기). data/voice-answers.sqlite3에 저장
    application.include_router(create_voice_router(VoiceAnswerStore(store.data_dir / "voice-answers.sqlite3"), client_key))
    application.add_api_route(
        "/health", health_check, methods=["GET"], tags=["서버 상태"],
        summary="서버 상태 확인",
        description="서버가 정상적으로 실행 중이면 `status: ok`를 반환합니다.",
    )
    application.add_api_route(
        "/upload", upload_image, methods=["POST"], tags=["사진 업로드"],
        summary="사진 업로드 및 JPEG 변환",
        description=(
            "사진의 실제 형식을 검사하고 회전 보정·RGB 변환 후 JPEG로 인코딩합니다. "
            "응답의 `source_format`은 입력 형식, `format`은 변환된 형식입니다. "
            "현재는 변환 결과의 크기·가로·세로 등 정보만 반환하며, "
            "사진을 영구 저장하거나 작품 DB에 등록하지 않습니다."
        ),
        responses={
            400: {"description": "빈 파일이거나 읽을 수 없는 이미지"},
            413: {"description": "파일 용량 또는 이미지 해상도 제한 초과"},
            415: {"description": "지원하지 않는 이미지 형식"},
        },
    )
    application.mount(
        "/images",
        StaticFiles(directory=store.images_dir, check_dir=False),
        name="artwork-images",
    )

    def public_artwork(record: dict, request: Request) -> dict:
        filename = record.pop("image_filename")
        record["image_url"] = str(request.url_for("artwork-images", path=filename))
        return record

    @application.get("/museums", response_model=MuseumList, tags=["작품 조회"], summary="등록 작품이 있는 미술관 목록")
    def list_museums(limit: Annotated[int, Query(ge=1, le=100)] = 20,
                     offset: Annotated[int, Query(ge=0)] = 0):
        return store.museums(limit, offset)

    @application.get(
        "/artworks", response_model=ArtworkList, tags=["작품 조회"],
        summary="등록된 작품 목록 조회",
        description=(
            "DB에 등록된 작품 목록과 전체 작품 수를 반환합니다. "
            "`limit`과 `offset`으로 조회 범위를 지정할 수 있습니다. "
            "각 작품에는 원본 이미지 URL이 포함되며, 미검수 해설은 `null`로 반환합니다."
        ),
    )
    def list_artworks(
        request: Request,
        museum_id: Annotated[str | None, Query(min_length=1)] = None,
        limit: Annotated[int, Query(ge=1, le=100, description="한 번에 가져올 작품 수 (1~100)")] = 20,
        offset: Annotated[int, Query(ge=0, description="앞에서 건너뛸 작품 수 (0부터 시작)")] = 0,
    ):
        records, total = store.list(limit, offset, museum_id)
        return {
            "items": [public_artwork(record, request) for record in records],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    # /artworks/{artwork_id}보다 먼저 등록해야 by-number가 작품 ID로 해석되지 않는다.
    @application.get(
        "/artworks/by-number", response_model=ArtworkDetail, tags=["작품 조회"],
        summary="작품 번호로 작품 조회",
        description=(
            "작품 번호로 작품 상세 정보를 조회합니다. 응답 형식은 작품 상세 조회와 같습니다. "
            "번호는 미술관별로 고유하므로, 여러 미술관에 같은 번호가 있으면 `museum_id`를 함께 보내야 합니다. 기존 `museum` 이름 필터도 지원합니다."
        ),
        responses={
            404: {"description": "해당 번호로 등록된 작품이 없음"},
            409: {"description": "여러 미술관에 같은 번호가 있어 museum_id 지정이 필요함"},
        },
    )
    def get_artwork_by_number(
        request: Request,
        number: Annotated[str, Query(min_length=1, description="작품 번호", examples=["INV 779"])],
        museum_id: Annotated[str | None, Query(min_length=1, description="미술관 목록에서 받은 ID")] = None,
        museum: Annotated[str | None, Query(min_length=1, description="미술관 이름", examples=["루브르 박물관"])] = None,
    ):
        records = store.find_by_number(number, museum, museum_id)
        if not records:
            raise HTTPException(status_code=404, detail="등록된 작품을 찾을 수 없습니다.")
        if len(records) > 1:
            raise HTTPException(status_code=409, detail="같은 번호의 작품이 여러 미술관에 있습니다. museum_id를 지정해 주세요.")
        return public_artwork(records[0], request)

    @application.get(
        "/artworks/{artwork_id}", response_model=ArtworkDetail, tags=["작품 조회"],
        summary="작품 상세 정보 조회",
        description=(
            "작품 ID로 제목·작가·제작 시기·작품 번호·미술관·배경·출처·이용 조건과 원본 이미지 URL을 조회합니다. "
            "사람이 검수한 해설이 있으면 함께 반환하며, 미검수 상태이면 해설은 `null`입니다. "
            "예시 작품 ID는 `mona-lisa`입니다."
        ),
        responses={404: {"description": "해당 ID로 등록된 작품이 없음"}},
    )
    def get_artwork(
        artwork_id: Annotated[str, PathParameter(description="조회할 작품의 고유 ID", examples=["mona-lisa"])],
        request: Request,
    ):
        record = store.get(artwork_id)
        if record is None:
            raise HTTPException(status_code=404, detail="등록된 작품을 찾을 수 없습니다.")
        return public_artwork(record, request)

    return application


app = create_app()
