"""짧은 음성 답(화면 맞추기의 숫자 등)을 OpenAI로 글자로 바꾼다. API 키는 서버에만 있다."""
import json
import os
from pathlib import Path
import re
import secrets
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

if __package__:
    from .accounts import RateLimiter
    from .ai.budget import GeminiBudget
else:
    from accounts import RateLimiter
    from ai.budget import GeminiBudget

# 10초 안팎의 짧은 답만 받는다. m4a(AAC) 10초는 보통 200KB 아래다.
MAX_AUDIO_BYTES = 2 * 1024 * 1024
ALLOWED_TYPES = {"audio/m4a", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"}
EXTENSION_TYPES = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".webm": "audio/webm", ".mp3": "audio/mpeg"}
# 숫자 답 위주로 알아듣도록 힌트를 준다(지시가 아니라 받아쓰기 맥락).
PROMPT = "시력 확인 그림의 숫자를 말합니다. 예: 45, 29, 73, 86, 숫자가 안 보여요."


class Transcript(BaseModel):
    text: str


def _multipart(fields, file_field, filename, content_type, content):
    boundary = f"----momi{secrets.token_hex(12)}"
    lines = []
    for name, value in fields.items():
        lines += [f"--{boundary}", f'Content-Disposition: form-data; name="{name}"', "", value]
    head = "\r\n".join(lines + [
        f"--{boundary}",
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"',
        f"Content-Type: {content_type}", "", "",
    ]).encode()
    return head + content + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def _urllib_post(url, body, headers, timeout):
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


class OpenAITranscriptionService:
    def __init__(self, data_dir: Path, post=_urllib_post):
        self.key = os.environ.get("OPENAI_API_KEY", "").strip()
        self.model = os.environ.get("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe").strip()
        self.post = post
        number = lambda key, default: float(os.environ.get(key) or default)
        # 음성 생성과 별도 장부. 짧은 답 1회는 입력 오디오 토큰 수백 개 수준이라 최대치를 넉넉히 잡는다.
        self.budget = GeminiBudget(
            data_dir / "openai-stt-usage.json",
            budget_krw=number("OPENAI_STT_BUDGET_KRW", 3000),
            daily_limit=int(number("OPENAI_STT_DAILY_LIMIT", 500)),
            input_usd_per_m=number("OPENAI_STT_INPUT_USD_PER_M", 3),
            output_usd_per_m=number("OPENAI_STT_OUTPUT_USD_PER_M", 5),
            krw_per_usd=number("OPENAI_STT_KRW_PER_USD", 1500),
            max_input_tokens=2000, max_output_tokens=100,
        )

    async def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        if not self.key:
            raise HTTPException(503, "음성 인식이 아직 연결되지 않았어요. 버튼으로 골라 주세요.")
        if not re.fullmatch(r"[a-zA-Z0-9.\-]+", self.model):
            raise HTTPException(503, "음성 인식 모델 설정을 확인해 주세요.")
        body, boundary_type = _multipart(
            {"model": self.model, "language": "ko", "prompt": PROMPT, "response_format": "json"},
            "file", filename, content_type, audio,
        )
        self.budget.reserve()
        try:
            status, raw = await run_in_threadpool(self.post, "https://api.openai.com/v1/audio/transcriptions", body, {
                "Authorization": f"Bearer {self.key}", "Content-Type": boundary_type,
            }, 20)
        except (OSError, TimeoutError):
            self.budget.release()
            raise HTTPException(502, "음성 인식 서버에 연결하지 못했어요. 다시 시도해 주세요.") from None
        if status != 200:
            self.budget.release()
            raise HTTPException(429 if status == 429 else 502, "지금은 음성을 알아듣지 못했어요. 버튼으로 골라 주세요.")
        try:
            data = json.loads(raw)
            text = str(data["text"]).strip()
        except (ValueError, KeyError, TypeError):
            self.budget.record(None)
            raise HTTPException(502, "음성 인식 결과가 올바르지 않아요. 다시 시도해 주세요.") from None
        usage = data.get("usage") if isinstance(data, dict) else None
        tokens = usage if isinstance(usage, dict) and "input_tokens" in usage else None
        self.budget.record({"promptTokenCount": tokens["input_tokens"], "candidatesTokenCount": tokens.get("output_tokens", 0)} if tokens else None)
        return text[:200]


def create_transcription_router(service):
    router = APIRouter()
    limiter = RateLimiter(attempts=30, window=60)

    @router.post("/transcribe", response_model=Transcript, tags=["작품 해설"],
                 summary="짧은 음성 답을 글자로 바꾸기 (화면 맞추기 숫자 답 등)")
    async def transcribe(request: Request, audio: UploadFile):
        limiter.check(request.client.host if request.client else "unknown")
        content_type = (audio.content_type or "").split(";")[0].strip().lower()
        if content_type in {"", "application/octet-stream"}:
            # 휴대폰 파일 업로드는 형식이 비어 오기도 한다. 녹음 파일 확장자로 정한다.
            content_type = EXTENSION_TYPES.get(Path(audio.filename or "").suffix.lower(), content_type)
        if content_type not in ALLOWED_TYPES:
            raise HTTPException(415, "지원하지 않는 음성 형식이에요.")
        content = await audio.read(MAX_AUDIO_BYTES + 1)
        if not content:
            raise HTTPException(422, "녹음된 소리가 없어요. 다시 말해 주세요.")
        if len(content) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "녹음이 너무 길어요. 짧게 말해 주세요.")
        filename = re.sub(r"[^a-zA-Z0-9._-]", "_", audio.filename or "answer.m4a")[:60] or "answer.m4a"
        return {"text": await service.transcribe(content, filename, content_type)}

    return router
