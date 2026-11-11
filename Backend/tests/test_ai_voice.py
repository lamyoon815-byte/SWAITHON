"""화면 맞추기 음성 답변 기록: 저장소와 API."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from Backend.ai.voice_answer import VoiceAnswerStore
from Backend.main import create_app

CHOICES = ["45", "86", "32", "숫자가 안 보여요"]


class VoiceAnswerStoreTests(unittest.TestCase):
    def test_add_list_delete(self):
        with TemporaryDirectory() as directory:
            store = VoiceAnswerStore(Path(directory) / "voice.sqlite3")
            first = store.add(session_id="session-1", step="screening", item="protan-45", choices=CHOICES,
                              transcript="사십오", choice="45", expected="45")
            store.add(session_id="session-1", step="color", item=None, choices=CHOICES,
                      transcript="음", choice=None, expected="86")
            store.add(session_id="session-2", step="screening", item=None, choices=CHOICES,
                      transcript="86", choice="86", expected="45")
            records = store.session("session-1")
            self.assertEqual(records[0]["id"], first["id"])
            self.assertEqual([r["is_correct"] for r in records], [True, None])
            self.assertEqual(records[0]["choices"], CHOICES)
            self.assertFalse(store.session("session-2")[0]["is_correct"])
            self.assertEqual(store.delete_session("session-1"), 2)
            self.assertEqual(store.session("session-1"), [])


class VoiceAnswerRouteTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.client = TestClient(create_app(Path(temp.name), gemini=object()))
        self.body = {"session_id": "test-session-01", "step": "screening", "item": "protan-45", "choices": CHOICES,
                     "transcript": "사십오인 것 같아요", "choice": "45", "expected": "45"}

    def test_save_list_delete(self):
        response = self.client.post("/calibration/voice-answers", json=self.body)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["is_correct"])
        self.client.post("/calibration/voice-answers", json={**self.body, "transcript": "잘 모르겠어요", "choice": None})
        items = self.client.get("/calibration/voice-answers/test-session-01").json()["items"]
        self.assertEqual([item["transcript"] for item in items], ["사십오인 것 같아요", "잘 모르겠어요"])
        self.assertEqual([item["is_correct"] for item in items], [True, None])
        self.assertEqual(self.client.delete("/calibration/voice-answers/test-session-01").json()["deleted"], 2)
        self.assertEqual(self.client.delete("/calibration/voice-answers/test-session-01").status_code, 404)

    def test_validation(self):
        post = lambda **change: self.client.post("/calibration/voice-answers", json={**self.body, **change}).status_code
        self.assertEqual(post(choice="77"), 422)       # 보기에 없는 답
        self.assertEqual(post(expected="77"), 422)
        self.assertEqual(post(choices=["45"]), 422)
        self.assertEqual(post(choices=["45", "45"]), 422)
        self.assertEqual(post(step="other"), 422)
        self.assertEqual(post(session_id="x"), 422)
        self.assertEqual(post(transcript="가" * 501), 422)
        self.assertEqual(post(audio="..."), 422)       # 음성 원본 등 정해지지 않은 값은 받지 않는다.
        self.assertEqual(self.client.get("/calibration/voice-answers/bad").status_code, 422)


if __name__ == "__main__":
    unittest.main()
