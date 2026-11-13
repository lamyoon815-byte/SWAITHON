from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from Backend.ai_routes import NARRATION_CACHE_VERSION, narration_key
from Backend.catalog import Description
from Backend.gemini import FeedbackIntent
from Backend.main import create_app


DESCRIPTION = {"facts": ["붉은 형태가 있습니다."], "interpretations": ["따뜻한 분위기입니다."], "regions": [], "mood_keywords": ["따뜻함"],
               "narration_order": [{"type": "fact", "index": 0}, {"type": "interpretation", "index": 0}]}


class FeedbackGemini:
    model = "fixture-model"

    def __init__(self):
        self.intent = FeedbackIntent()
        self.error = None
        self.comments = []
        self.focuses = []

    def interpret_feedback(self, satisfaction, comment):
        self.comments.append((satisfaction, comment))
        if self.error:
            raise self.error
        return self.intent

    def describe(self, content, metadata=None, brief=False, focus="balanced"):
        self.focuses.append(focus)
        return Description.model_validate(DESCRIPTION)


class NoRecognition:
    """실제 CLIP 모델을 불러오지 않게 한다(.env의 CLIP_WARMUP과 무관하게)."""
    def recognize_artwork(self, content):
        return []


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.gemini = FeedbackGemini()
        self.app = create_app(root / "data", recognition=NoRecognition(), gemini=self.gemini)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        with Image.new("RGB", (16, 8), "red") as image:
            stream = BytesIO()
            image.save(stream, format="PNG")
        (root / "sample.png").write_bytes(stream.getvalue())
        manifest = root / "catalog.json"
        manifest.write_text(json.dumps([{"id": "sample", "title": "작품", "artist": "작가", "image_path": "sample.png",
                                         "review_status": "pending"}]))
        self.app.state.catalog.import_manifest(manifest)
        result = self.client.post("/auth/register", json={"email": "viewer@example.com", "password": "password-12345", "nickname": "관람객"})
        self.headers = {"Authorization": "Bearer " + result.json()["access_token"]}

    def set_profile(self, **values):
        profile = self.client.get("/me/profile", headers=self.headers).json()
        response = self.client.put("/me/profile", json={**profile, **values}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def submit(self, comment="색이 너무 진하고 말이 빨라요", satisfaction="bad"):
        response = self.client.post("/me/feedback", json={"artwork_id": "sample", "satisfaction": satisfaction, "comment": comment},
                                    headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_rating_without_comment_is_saved_without_ai(self):
        result = self.submit(comment=None, satisfaction="good")
        self.assertFalse(result["interpreted"])
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(self.gemini.comments, [])
        self.assertEqual(result["message"], "소중한 의견 감사합니다.")
        with self.app.state.accounts.connect() as connection:
            row = connection.execute("SELECT satisfaction, comment, intent_json FROM feedback").fetchone()
        self.assertEqual(tuple(row), ("good", None, None))

    def test_unregistered_analysis_feedback_is_saved_without_a_catalog_entry(self):
        self.gemini.intent = FeedbackIntent(speech_rate="slower")
        self.set_profile(speech_rate=1.0)
        response = self.client.post("/me/feedback", headers=self.headers, json={
            "analysis_id": "capture-session-1", "satisfaction": "bad", "comment": "해설이 빨라요", "apply": True})
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertIsNone(result["artwork_id"])
        self.assertEqual(result["analysis_id"], "capture-session-1")
        self.assertEqual(result["applied"], ["speech_rate"])
        self.assertEqual(result["profile"]["speech_rate"], 0.75)
        with self.app.state.accounts.connect() as connection:
            row = connection.execute("SELECT artwork_id, analysis_id, satisfaction FROM feedback").fetchone()
        self.assertEqual(tuple(row), ("", "capture-session-1", "bad"))
        again = self.client.post(f"/me/feedback/{result['id']}/apply", headers=self.headers, json={"fields": ["speech_rate"]})
        self.assertEqual(again.status_code, 409)

    def test_feedback_requires_exactly_one_registered_or_analysis_target(self):
        for target in ({}, {"artwork_id": "sample", "analysis_id": "capture-1"}, {"analysis_id": ""}):
            response = self.client.post("/me/feedback", headers=self.headers, json={**target, "satisfaction": "okay"})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.post("/me/feedback", json={"analysis_id": "capture-1", "satisfaction": "okay"}).status_code, 401)

    def test_existing_feedback_database_migrates_without_losing_registered_ratings(self):
        registered = self.submit(comment=None)
        with self.app.state.accounts.connect() as connection:
            connection.execute("ALTER TABLE feedback DROP COLUMN analysis_id")
        self.app.state.accounts.initialize()
        response = self.client.post("/me/feedback", headers=self.headers, json={"analysis_id": "capture-2", "satisfaction": "good"})
        self.assertEqual(response.status_code, 201, response.text)
        with self.app.state.accounts.connect() as connection:
            self.assertEqual(connection.execute("SELECT artwork_id FROM feedback WHERE id = ?", (registered["id"],)).fetchone()[0], "sample")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 2)

    def test_comment_becomes_bounded_one_step_suggestions(self):
        self.set_profile(calibration={"color_type": "deutan", "severity": 0.6, "edge": 0.4}, contrast=0.5, speech_rate=1.0)
        self.gemini.intent = FeedbackIntent(color="weaker", contrast="lower", speech_rate="slower",
                                            narration_length="detailed", narration_focus="color", narration_mode="both")
        result = self.submit()
        self.assertTrue(result["interpreted"])
        by_field = {item["field"]: item for item in result["suggestions"]}
        # 대비는 이미 최저(0.5)라 제안하지 않고, 해설 방식은 이미 both라 제안하지 않는다.
        self.assertEqual(set(by_field), {"color_severity", "speech_rate", "narration_length", "narration_focus"})
        self.assertEqual((by_field["color_severity"]["current"], by_field["color_severity"]["proposed"]), (0.6, 0.4))
        self.assertEqual(by_field["speech_rate"]["proposed"], 0.75)
        self.assertEqual(by_field["narration_focus"]["proposed"], "color")
        self.assertEqual(self.gemini.comments, [("bad", "색이 너무 진하고 말이 빨라요")])

    def test_apply_only_chosen_fields_once(self):
        self.set_profile(calibration={"color_type": "protan", "severity": 0.6, "edge": 0.4,
                                      "color_severities": {"protan": 0.6, "deutan": 0.8, "tritan": 0}})
        self.gemini.intent = FeedbackIntent(color="weaker", edge="stronger", narration_focus="position")
        feedback = self.submit()
        response = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["color_severity", "narration_focus"]},
                                    headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["applied"], ["color_severity", "narration_focus"])
        profile = self.client.get("/me/profile", headers=self.headers).json()
        self.assertEqual(profile["calibration"]["severity"], 0.4)
        # 다른 색각 종류의 세기는 그대로, 고르지 않은 윤곽선도 그대로다.
        self.assertEqual(profile["calibration"]["color_severities"], {"protan": 0.4, "deutan": 0.8, "tritan": 0.0})
        self.assertEqual(profile["calibration"]["edge"], 0.4)
        self.assertEqual(profile["narration_focus"], "position")
        again = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["edge"]}, headers=self.headers)
        self.assertEqual(again.status_code, 409)

    def test_failed_profile_save_releases_the_feedback(self):
        self.gemini.intent = FeedbackIntent(contrast="higher")
        feedback = self.submit()
        with patch.object(self.app.state.accounts, "set_profile", side_effect=HTTPException(409, "conflict")):
            failed = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["contrast"]}, headers=self.headers)
        self.assertEqual(failed.status_code, 409)
        retry = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["contrast"]}, headers=self.headers)
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json()["profile"]["contrast"], 1.1)

    def test_nothing_to_apply_after_value_reached_the_limit(self):
        self.gemini.intent = FeedbackIntent(contrast="lower")
        feedback = self.submit()
        self.set_profile(contrast=0.5)
        response = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["contrast"]}, headers=self.headers)
        self.assertEqual(response.status_code, 409)

    def test_ai_failure_still_saves_feedback(self):
        self.gemini.error = HTTPException(429, "limit")
        result = self.submit()
        self.assertFalse(result["interpreted"])
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(result["message"], "소중한 의견 감사합니다.")
        no_intent = self.client.post(f"/me/feedback/{result['id']}/apply", json={"fields": ["contrast"]}, headers=self.headers)
        self.assertEqual(no_intent.status_code, 409)

    def test_requires_login_known_artwork_and_owner(self):
        body = {"artwork_id": "sample", "satisfaction": "okay"}
        self.assertEqual(self.client.post("/me/feedback", json=body).status_code, 401)
        self.assertEqual(self.client.post("/me/feedback", json={**body, "artwork_id": "missing"}, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.post("/me/feedback", json={**body, "satisfaction": "great"}, headers=self.headers).status_code, 422)
        self.gemini.intent = FeedbackIntent(contrast="higher")
        feedback = self.submit()
        other = self.client.post("/auth/register", json={"email": "other@example.com", "password": "password-12345", "nickname": "다른"})
        other_headers = {"Authorization": "Bearer " + other.json()["access_token"]}
        response = self.client.post(f"/me/feedback/{feedback['id']}/apply", json={"fields": ["contrast"]}, headers=other_headers)
        self.assertEqual(response.status_code, 404)

    def test_apply_true_changes_profile_at_once_and_says_what_changed(self):
        self.set_profile(calibration={"color_type": "deutan", "severity": 0.6, "edge": 0.4})
        self.gemini.intent = FeedbackIntent(color="weaker", narration_length="detailed")
        response = self.client.post("/me/feedback", headers=self.headers, json={
            "artwork_id": "sample", "satisfaction": "bad", "comment": "색이 진하고 더 자세히 듣고 싶어요", "apply": True})
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual(result["applied"], ["color_severity", "narration_length"])
        self.assertEqual(result["profile"]["calibration"]["severity"], 0.4)
        self.assertEqual(result["profile"]["narration_length"], "detailed")
        self.assertEqual([item["message"] for item in result["suggestions"]],
                         ["색 보정을 조금 약하게 했어요", "다음 해설은 3분 정도로 자세히 들려 드릴게요"])
        self.assertIn("바꿨어요", result["message"])
        profile = self.client.get("/me/profile", headers=self.headers).json()
        self.assertEqual(profile["calibration"]["severity"], 0.4)
        again = self.client.post(f"/me/feedback/{result['id']}/apply", json={"fields": ["color_severity"]}, headers=self.headers)
        self.assertEqual(again.status_code, 409)

    def test_apply_true_keeps_feedback_when_profile_save_fails(self):
        self.gemini.intent = FeedbackIntent(contrast="higher")
        with patch.object(self.app.state.accounts, "set_profile", side_effect=HTTPException(409, "conflict")):
            response = self.client.post("/me/feedback", headers=self.headers, json={
                "artwork_id": "sample", "satisfaction": "bad", "comment": "흐릿해요", "apply": True})
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual((result["applied"], result["profile"]), ([], None))
        self.assertIn("바꾸지 못했어요", result["message"])
        retry = self.client.post(f"/me/feedback/{result['id']}/apply", json={"fields": ["contrast"]}, headers=self.headers)
        self.assertEqual(retry.status_code, 200, retry.text)

    def test_narration_focus_has_its_own_cache_and_balanced_keeps_old_key(self):
        record, content = {"id": "x"}, b"image"
        self.assertEqual(narration_key("brief", "m", record, content), narration_key("brief", "m", record, content, "balanced"))
        self.assertNotEqual(narration_key("brief", "m", record, content), narration_key("brief", "m", record, content, "color"))
        self.assertTrue(NARRATION_CACHE_VERSION)
        for focus in ("balanced", "color", "color"):
            response = self.client.post(f"/artworks/sample/narration?focus={focus}")
            self.assertEqual(response.status_code, 200, response.text)
        # 같은 초점은 저장된 해설을 다시 쓴다.
        self.assertEqual(self.gemini.focuses, ["balanced", "color"])


if __name__ == "__main__":
    unittest.main()
