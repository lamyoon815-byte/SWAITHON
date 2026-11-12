"""해설 분위기 분류(ai/mood_classifier.py)와 배경 음악 API(ai/mood_routes.py)."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import get_args
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from Backend.ai.mood_classifier import MoodCategory, classify_narration
from Backend.ai.mood_music import CATEGORIES, MUSIC_ROOT, all_tracks, music_file
from Backend.ai.mood_routes import create_mood_router
from Backend.generated_cache import GeneratedCache
from Backend.main import create_app

TEXT = "성모와 아기 예수를 금빛 배경 위에 그린 제단화입니다. 천사들이 둘러싸고 기도하는 모습이 경건합니다."


class FakeGemini:
    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.prompts = reply, error, []

    def generate(self, content, prompt, result_type, grounded=False):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return result_type.model_validate(self.reply)


class ClassifierTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data = Path(temp.name)
        self.cache = GeneratedCache(self.data)

    def test_categories_match_music_list(self):
        self.assertEqual(list(get_args(MoodCategory)), [c["key"] for c in CATEGORIES])

    def test_gemini_result_is_cached(self):
        gemini = FakeGemini({"category": "sacred", "energy": "soft"})
        first = classify_narration(gemini, TEXT, "성모자", artwork_id="met-9", cache=self.cache)
        self.assertEqual(first, {"category": "sacred", "name": "경건·성스러움", "energy": "soft", "energy_name": "잔잔한 곡",
                                 "source": "gemini"})
        self.assertIn("성모자", gemini.prompts[0])
        self.assertIn("korean: 한국·동양 전통", gemini.prompts[0])
        self.assertIn("lively = 움직임", gemini.prompts[0])
        again = classify_narration(FakeGemini(error=AssertionError("다시 호출하면 안 됨")), TEXT,
                                   artwork_id="met-9", cache=self.cache)
        self.assertEqual((again["source"], again["energy"]), ("gemini", "soft"))

    def test_fallbacks_when_gemini_fails(self):
        busy = FakeGemini(error=HTTPException(429, "예산 초과"))
        # 1) 그림으로 분류한 결과(mood_music.py)
        (self.data / "momi-music").mkdir()
        (self.data / "momi-music" / "music_manifest.json").write_text(
            json.dumps({"items": [{"artwork_id": "nmk-1", "category": "korean"}]}), encoding="utf-8")
        image = classify_narration(busy, "흥겨운 춤과 축제 장면입니다.", artwork_id="nmk-1", cache=self.cache)
        self.assertEqual((image["category"], image["energy"], image["source"]), ("korean", "lively", "image"))
        # 2) 분위기 키워드. 에너지는 단어로 정한다(쓸쓸 → 잔잔한 곡).
        result = classify_narration(busy, "다른 해설", mood_keywords=["쓸쓸함", "고독"], artwork_id="x-1", cache=self.cache)
        self.assertEqual((result["category"], result["energy"], result["source"]), ("melancholy", "soft", "keywords"))
        stormy = classify_narration(busy, "폭풍 속 격렬한 전투", mood_keywords=["긴장"], artwork_id="x-2", cache=self.cache)
        self.assertEqual((stormy["category"], stormy["energy"]), ("dramatic", "lively"))
        # 3) 아무것도 없으면 평온의 기본 곡
        fallback = classify_narration(busy, "또 다른 해설", cache=self.cache)
        self.assertEqual((fallback["category"], fallback["energy"], fallback["source"]), ("calm", "soft", "default"))
        # 실패 결과는 저장하지 않아서, 나중에 Gemini가 되면 다시 분류한다.
        later = classify_narration(FakeGemini({"category": "dreamy", "energy": "lively"}), "또 다른 해설", cache=self.cache)
        self.assertEqual((later["category"], later["energy"]), ("dreamy", "lively"))

    def test_invalid_category_from_model_falls_back(self):
        for reply in ({"category": "jazz", "energy": "soft"}, {"category": "calm", "energy": "loud"}, {"category": "calm"}):
            result = classify_narration(FakeGemini(reply), TEXT, cache=self.cache)
            self.assertEqual(result["source"], "default", reply)


class MoodRouteTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data = Path(temp.name)
        self.gemini = FakeGemini({"category": "calm", "energy": "lively"})
        self.client = TestClient(create_app(self.data, gemini=self.gemini))

    def test_mood_endpoint(self):
        response = self.client.post("/narration/mood", json={"text": TEXT, "mood_keywords": ["경건"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"category": "calm", "name": "평온·고요", "energy": "lively", "energy_name": "움직임 있는 곡",
                                           "music_url": "/music/calm/lively", "music_volume": 0.933, "credit": None, "source": "gemini"})
        korean = TestClient(create_app(self.data / "k", gemini=FakeGemini({"category": "korean", "energy": "lively"})))
        self.assertEqual(korean.post("/narration/mood", json={"text": "아리랑"}).json()["credit"],
                         "군밤타령, 한국저작권위원회, 공유마당, CC BY 4.0")
        self.assertEqual(self.client.post("/narration/mood", json={"text": ""}).status_code, 422)
        self.assertEqual(self.client.post("/narration/mood", json={"text": "가" * 6001}).status_code, 422)
        self.assertEqual(self.client.post("/narration/mood", json={"text": "a", "extra": 1}).status_code, 422)

    def test_music_files(self):
        self.assertEqual(self.client.get("/music/jazz").status_code, 422)
        # 음악 폴더에 파일이 없으면 404
        catalog = type("Catalog", (), {"data_dir": self.data, "get": lambda self, artwork_id: None})()
        app = FastAPI()
        app.include_router(create_mood_router(catalog, self.gemini, lambda request: "test", music_root=self.data))
        empty = TestClient(app)
        self.assertEqual(empty.get("/music/calm").status_code, 404)
        path = self.data / music_file(0, CATEGORIES[0])
        path.parent.mkdir(parents=True)
        path.write_bytes(b"ID3" + b"\x00" * 1000)
        response = empty.get("/music/calm")
        self.assertEqual((response.status_code, response.headers["content-type"]), (200, "audio/mpeg"))
        self.assertEqual(empty.get("/music/calm/soft").content, response.content)  # 평온의 기본 곡은 잔잔한 곡
        self.assertEqual(empty.get("/music/calm/lively").status_code, 404)
        self.assertEqual(empty.get("/music/calm/loud").status_code, 422)
        self.assertIn("max-age", response.headers["cache-control"])

    def test_git_music_folder_has_all_twenty(self):
        # 음악 20곡은 git에 함께 올린 Backend/music/에서 바로 나간다(서버에 따로 복사할 필요 없음).
        tracks = list(all_tracks())
        self.assertEqual(len(tracks), 20)
        for index, category, energy, _ in tracks:
            path = MUSIC_ROOT / music_file(index, category, energy)
            self.assertTrue(path.is_file(), path.name)
        response = self.client.get("/music/korean/lively")
        self.assertEqual((response.status_code, response.headers["content-type"]), (200, "audio/mpeg"))
        self.assertTrue((MUSIC_ROOT / "music" / "CREDITS.md").is_file())


if __name__ == "__main__":
    unittest.main()
