"""해설 분위기 분류와 공통 음악 파일 제공. 해설 API의 호출 제한과 독립적이다."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .mood_classifier import MoodCategory, classify_narration
from .mood_music import CATEGORIES, MUSIC_ROOT, music_file

if __package__ and "." in __package__:
    from ..accounts import RateLimiter
    from ..generated_cache import GeneratedCache
else:
    from accounts import RateLimiter
    from generated_cache import GeneratedCache


class MoodInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=6000)
    artwork_id: str | None = Field(default=None, max_length=100)
    mood_keywords: list[str] = Field(default_factory=list, max_length=10)


class NarrationMood(BaseModel):
    category: MoodCategory
    name: str
    music_url: str
    credit: str | None = None
    source: Literal["gemini", "image", "keywords", "default"]


def create_mood_router(catalog, gemini, client_key, music_root: Path = MUSIC_ROOT):
    router = APIRouter(tags=["해설 배경 음악"])
    limiter = RateLimiter(attempts=20, window=60)
    cache = GeneratedCache(catalog.data_dir)
    # 음악 10곡은 git에 함께 올린 Backend/music/ 폴더에 있다.
    files = {category["key"]: Path(music_root) / music_file(index, category)
             for index, category in enumerate(CATEGORIES)}

    @router.post("/narration/mood", response_model=NarrationMood, summary="해설 전체의 분위기로 배경 음악 선택")
    async def narration_mood(data: MoodInput, request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        limiter.check(client_key(request))
        record = await run_in_threadpool(catalog.get, data.artwork_id) if data.artwork_id else None
        result = await run_in_threadpool(classify_narration, gemini, data.text,
                                        title=record.get("title") if record else None,
                                        mood_keywords=data.mood_keywords, artwork_id=data.artwork_id, cache=cache)
        track = next(c["track"] for c in CATEGORIES if c["key"] == result["category"])
        # CC BY 곡은 앱 화면에 출처를 보여 줘야 한다.
        return {**result, "music_url": f"/music/{result['category']}", "credit": track.get("attribution")}

    @router.get("/music/{category}", response_class=FileResponse, summary="분위기별 배경 음악 MP3")
    def background_music(category: MoodCategory):
        path = files[category]
        if not path.is_file():
            raise HTTPException(404, "배경 음악 파일이 서버에 없어요. Backend/music 폴더를 확인해 주세요.")
        return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})

    return router
