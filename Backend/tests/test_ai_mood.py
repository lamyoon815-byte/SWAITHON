"""해설 분위기 분류(ai/mood_classifier.py)와 배경 음악 API(ai/mood_routes.py)."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import get_args
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from Backend.ai.mood_classifier import MoodCategory, classify_narration
from Backend.ai.mood_music import CATEGORIES, MUSIC_ROOT, music_file
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
        gemini = FakeGemini({"category": "sacred"})
        first = classify_narration(gemini, TEXT, "성모자", artwork_id="met-9", cache=self.cache)
        self.assertEqual(first, {"category": "sacred", "name": "경건·성스러움", "source": "gemini"})
        self.assertIn("성모자", gemini.prompts[0])
        self.assertIn("korean: 한국·동양 전통", gemini.prompts[0])
        again = classify_narration(FakeGemini(error=AssertionError("다시 호출하면 안 됨")), TEXT,
                                   artwork_id="met-9", cache=self.cache)
        self.assertEqual(again["source"], "gemini")

    def test_fallbacks_when_gemini_fails(self):
        busy = FakeGemini(error=HTTPException(429, "예산 초과"))
        # 1) 그림으로 분류한 결과(mood_music.py)
        (self.data / "momi-music").mkdir()
        (self.data / "momi-music" / "music_manifest.json").write_text(
            json.dumps({"items": [{"artwork_id": "nmk-1", "category": "korean"}]}), encoding="utf-8")
        self.assertEqual(classify_narration(busy, TEXT, artwork_id="nmk-1", cache=self.cache)["source"], "image")
        # 2) 분위기 키워드
        result = classify_narration(busy, "다른 해설", mood_keywords=["쓸쓸함", "고독"], artwork_id="x-1", cache=self.cache)
        self.assertEqual((result["category"], result["source"]), ("melancholy", "keywords"))
        # 3) 아무것도 없으면 평온
        self.assertEqual(classify_narration(busy, "또 다른 해설", cache=self.cache)["source"], "default")
        # 실패 결과는 저장하지 않아서, 나중에 Gemini가 되면 다시 분류한다.
        later = classify_narration(FakeGemini({"category": "dreamy"}), "또 다른 해설", cache=self.cache)
        self.assertEqual(later["category"], "dreamy")

    def test_invalid_category_from_model_falls_back(self):
        result = classify_narration(FakeGemini({"category": "jazz"}), TEXT, cache=self.cache)
        self.assertEqual(result["source"], "default")


class MoodRouteTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data = Path(temp.name)
        self.gemini = FakeGemini({"category": "calm"})
        self.client = TestClient(create_app(self.data, gemini=self.gemini))

    def test_mood_endpoint(self):
        response = self.client.post("/narration/mood", json={"text": TEXT, "mood_keywords": ["경건"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"category": "calm", "name": "평온·고요", "music_url": "/music/calm", "credit": None, "source": "gemini"})
        korean = TestClient(create_app(self.data / "k", gemini=FakeGemini({"category": "korean"})))
        self.assertIn("CC BY 4.0", korean.post("/narration/mood", json={"text": "아리랑"}).json()["credit"])
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
        self.assertIn("max-age", response.headers["cache-control"])

    def test_git_music_folder_has_all_ten(self):
        # 음악 10곡은 git에 함께 올린 Backend/music/에서 바로 나간다(서버에 따로 복사할 필요 없음).
        for index, category in enumerate(CATEGORIES):
            self.assertTrue((MUSIC_ROOT / music_file(index, category)).is_file(), category["key"])
        response = self.client.get("/music/korean")
        self.assertEqual((response.status_code, response.headers["content-type"]), (200, "audio/mpeg"))
        self.assertTrue((MUSIC_ROOT / "music" / "CREDITS.md").is_file())


if __name__ == "__main__":
    unittest.main()
