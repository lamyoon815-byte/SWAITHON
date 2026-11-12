"""해설 분위기 분류와 공통 음악 파일 제공. 해설 API의 호출 제한과 독립적이다."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .mood_classifier import Energy, MoodCategory, classify_narration
from .mood_music import CATEGORIES, MUSIC_ROOT, all_tracks, music_file

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


# 곡마다 녹음 음량이 30dB 넘게 달라, 모두 같은 음량(25%)으로 틀면 조용한 곡(짐노페디 등)은 해설에 묻혀 안 들렸다.
# 값: 각 MP3를 디코딩해 0.5초 구간 RMS의 중앙값(dBFS)으로 잰 음량(2026-11-12). 곡 파일을 바꾸면 다시 잰다.
MUSIC_LOUDNESS_DBFS = {
    "01_calm.mp3": -35.0, "01_calm_lively.mp3": -35.4, "02_lyrical.mp3": -17.7, "02_lyrical_lively.mp3": -23.8,
    "03_bright.mp3": -29.0, "03_bright_soft.mp3": -48.3, "04_pastoral.mp3": -28.9, "04_pastoral_lively.mp3": -20.6,
    "05_sacred.mp3": -22.0, "05_sacred_soft.mp3": -30.5, "06_majestic.mp3": -26.2, "06_majestic_soft.mp3": -37.6,
    "07_melancholy.mp3": -32.4, "07_melancholy_lively.mp3": -25.7, "08_dramatic.mp3": -32.5, "08_dramatic_soft.mp3": -41.0,
    "09_dreamy.mp3": -30.9, "09_dreamy_lively.mp3": -30.2, "10_korean.mp3": -17.8, "10_korean_lively.mp3": -19.6,
}
# 해설 음성(중앙 약 -24dBFS)보다 약 12dB 작게, 배경으로 또렷이 들리는 크기로 맞춘다(16dB도 시험 후 12dB로 결정).
MUSIC_TARGET_DBFS = -36.0
DEFAULT_MUSIC_VOLUME = 0.25


# ai/normalize_music.py로 곡 안의 큰 대목을 누르고 중간 음량을 맞춘 파일(Backend/music/normalized/*.m4a).
# 있으면 이 파일을 보내고, 모든 곡이 같은 크기라 재생 음량도 같다.
NORMALIZED_DBFS = -24.0
MUSIC_VERSION = "2"


def normalized_path(path: Path) -> Path:
    return path.parent / "normalized" / f"{path.stem}.m4a"


def track_volume(path: Path) -> float:
    if normalized_path(path).is_file():
        return round(min(1.0, 10 ** ((MUSIC_TARGET_DBFS - NORMALIZED_DBFS) / 20)), 3)
    return music_volume(path.name)


def music_volume(filename: str) -> float:
    """곡을 이 음량(0~1)으로 틀면 어떤 곡이든 비슷한 크기로 들린다. 1을 넘을 수 없어 아주 조용한 곡은 목표보다 작다."""
    loudness = MUSIC_LOUDNESS_DBFS.get(filename)
    if loudness is None:
        return DEFAULT_MUSIC_VOLUME
    return round(min(1.0, 10 ** ((MUSIC_TARGET_DBFS - loudness) / 20)), 3)


class NarrationMood(BaseModel):
    category: MoodCategory
    name: str
    energy: Energy
    energy_name: str
    music_url: str
    music_volume: float = Field(default=DEFAULT_MUSIC_VOLUME, ge=0, le=1, description="이 곡을 틀 음량(0~1). 곡마다 녹음 음량이 달라 서버가 맞춰 준다")
    credit: str | None = None
    source: Literal["gemini", "image", "keywords", "default"]


def create_mood_router(catalog, gemini, client_key, music_root: Path = MUSIC_ROOT):
    router = APIRouter(tags=["해설 배경 음악"])
    limiter = RateLimiter(attempts=20, window=60)
    cache = GeneratedCache(catalog.data_dir)
    # 음악 20곡(분위기 10가지 × 잔잔한 곡/움직임 있는 곡)은 git에 함께 올린 Backend/music/ 폴더에 있다.
    files = {(category["key"], energy): Path(music_root) / music_file(index, category, energy)
             for index, category, energy, _ in all_tracks()}
    default_energy = {category["key"]: category["energy"] for category in CATEGORIES}

    @router.post("/narration/mood", response_model=NarrationMood, summary="해설 전체의 분위기로 배경 음악 선택")
    async def narration_mood(data: MoodInput, request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        limiter.check(client_key(request))
        record = await run_in_threadpool(catalog.get, data.artwork_id) if data.artwork_id else None
        result = await run_in_threadpool(classify_narration, gemini, data.text,
                                        title=record.get("title") if record else None,
                                        mood_keywords=data.mood_keywords, artwork_id=data.artwork_id, cache=cache)
        track = next(c for c in CATEGORIES if c["key"] == result["category"])["tracks"][result["energy"]]
        # CC BY 곡은 앱 화면에 출처를 보여 줘야 한다.
        path = files[(result["category"], result["energy"])]
        # 다듬은 파일로 바뀌면 주소에 버전을 붙여 폰에 남은 예전 MP3를 쓰지 않게 한다.
        version = f"?v={MUSIC_VERSION}" if normalized_path(path).is_file() else ""
        return {**result, "music_url": f"/music/{result['category']}/{result['energy']}{version}", "credit": track.get("attribution"),
                "music_volume": track_volume(path)}

    @router.get("/music/{category}", response_class=FileResponse, summary="분위기별 기본 배경 음악 MP3")
    def default_music(category: MoodCategory):
        return _music(category, default_energy[category])

    @router.get("/music/{category}/{energy}", response_class=FileResponse, summary="분위기·에너지별 배경 음악 MP3")
    def background_music(category: MoodCategory, energy: Energy):
        return _music(category, energy)

    def _music(category, energy):
        path = files[(category, energy)]
        normalized = normalized_path(path)
        if normalized.is_file():
            return FileResponse(normalized, media_type="audio/mp4", headers={"Cache-Control": "public, max-age=86400"})
        if not path.is_file():
            raise HTTPException(404, "배경 음악 파일이 서버에 없어요. Backend/music 폴더를 확인해 주세요.")
        return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})

    return router
