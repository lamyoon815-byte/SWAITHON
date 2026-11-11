from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from Backend.catalog import Description
from Backend.gemini import FallbackDescription, GeminiService, PlacardText
from Backend.ai_routes import correct_jpeg
from Backend.ai.profile import AIProfile
from Backend.main import create_app


DESCRIPTION = {"facts": ["붉은 형태가 있습니다."], "interpretations": ["따뜻하게 느껴질 수 있습니다."], "regions": [], "mood_keywords": ["따뜻함"]}


class FixtureGemini:
    def read_placard(self, content):
        return PlacardText(title="작품", artist="작가", text="작품 작가")

    def describe(self, content, metadata=None):
        return Description.model_validate(DESCRIPTION)


class FixtureRecognition:
    def recognize_artwork(self, content):
        return [{"artwork_id": "sample", "title": "작품", "artist": "작가", "score": 0.7}]

    def match_placard(self, title, artist, text):
        return [{"artwork_id": "sample", "title": title, "artist": artist, "score": 1}]


class AIRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = create_app(self.root / "data", recognition=FixtureRecognition(), gemini=FixtureGemini())
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        with Image.new("RGB", (16, 8), "red") as image:
            stream = BytesIO()
            image.save(stream, format="PNG")
        self.image = stream.getvalue()
        (self.root / "sample.png").write_bytes(self.image)
        self.manifest = self.root / "catalog.json"
        self.seed("reviewed")
        result = self.client.post("/auth/register", json={"email": "visitor@example.com", "password": "password-12345", "nickname": "관람객"})
        self.headers = {"Authorization": "Bearer " + result.json()["access_token"]}

    def seed(self, status):
        self.manifest.write_text(json.dumps([{"id": "sample", "title": "작품", "artist": "작가", "image_path": "sample.png", "description": DESCRIPTION, "review_status": status}]))
        self.app.state.catalog.import_manifest(self.manifest)

    def test_artwork_and_placard_response(self):
        for mode, score_type in [("artwork", "cosine_similarity"), ("placard", "fuzzy_text_similarity")]:
            response = self.client.post("/recognize", headers=self.headers, data={"mode": mode}, files={"image": ("sample.png", self.image, "image/png")})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["candidates"][0]["artwork_id"], "sample")
            self.assertEqual(response.json()["score_type"], score_type)
            self.assertEqual(response.json()["status"], "needs_confirmation")
            self.assertEqual(self.client.get(response.json()["candidates"][0]["image_url"]).status_code, 200)

    def test_no_login_needed_and_bad_image_rejected(self):
        # 앱은 로그인 없이 기기 로컬 저장만 쓰므로 인식·분석은 토큰 없이 동작한다.
        for route in ["/recognize", "/analyze"]:
            self.assertEqual(self.client.post(route, files={"image": ("x.png", self.image, "image/png")}).status_code, 200)
            self.assertEqual(self.client.post(route, files={"image": ("x.png", b"not image", "image/png")}).status_code, 400)
        self.assertEqual(self.client.post("/recognize", data={"mode": "unknown"}, files={"image": ("x.png", self.image, "image/png")}).status_code, 422)

    def test_analyze_does_not_register_or_save_photos(self):
        before = {path.name for path in self.app.state.catalog.images_dir.iterdir()}
        response = self.client.post("/analyze", headers=self.headers, files={"image": ("x.png", self.image, "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["review_status"], "unreviewed")
        self.assertEqual(self.client.get("/artworks").json()["total"], 1)
        self.assertEqual(before, {path.name for path in self.app.state.catalog.images_dir.iterdir()})

    def test_generate_registered_narration_uses_metadata_and_stays_unreviewed(self):
        self.seed("pending")
        self.assertEqual(self.client.get("/artworks/sample/narration").status_code, 409)
        before = {path.name for path in self.app.state.catalog.images_dir.iterdir()}
        with patch.object(FixtureGemini, "describe", return_value=Description.model_validate(DESCRIPTION)) as describe:
            response = self.client.post("/artworks/sample/narration")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["review_status"], "unreviewed")
        self.assertFalse(data["fallback"])
        self.assertEqual(data["segments"][0]["text"], DESCRIPTION["facts"][0])
        self.assertTrue(data["segments"][1]["text"].startswith("가능한 감정적 해석입니다."))
        self.assertEqual(describe.call_args.args[1]["title"], "작품")
        self.assertEqual(response.headers["cache-control"], "no-store")
        # Generated text must never silently become a reviewed catalog description.
        self.assertEqual(self.client.get("/artworks/sample/narration").status_code, 409)
        self.assertIsNone(self.client.get("/artworks/sample").json()["description"])
        self.assertEqual(before, {path.name for path in self.app.state.catalog.images_dir.iterdir()})

    def test_narration_survives_restart_and_cache_hits_do_not_use_ai_limit(self):
        first = self.client.post("/artworks/sample/narration")
        self.assertEqual(first.status_code, 200)
        restarted = create_app(self.root / "data", recognition=FixtureRecognition(), gemini=FixtureGemini())
        with TestClient(restarted) as client, patch.object(FixtureGemini, "describe", side_effect=AssertionError("must reuse DB")):
            for _ in range(7):
                response = client.post("/artworks/sample/narration")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), first.json())

    def test_simultaneous_requests_generate_the_artwork_once(self):
        barrier = Barrier(4)
        def request():
            barrier.wait(timeout=5)
            return self.client.post("/artworks/sample/narration")
        with patch.object(FixtureGemini, "describe", return_value=Description.model_validate(DESCRIPTION)) as describe:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: request(), range(4)))
            self.assertTrue(all(result.status_code == 200 for result in results))
            self.assertTrue(all(result.json() == results[0].json() for result in results))
            self.assertEqual(describe.call_count, 1)

    def test_narration_metadata_change_invalidates_saved_description(self):
        self.assertEqual(self.client.post("/artworks/sample/narration").status_code, 200)
        manifest = json.loads(self.manifest.read_text())
        manifest[0]["title"] = "새 제목"
        self.manifest.write_text(json.dumps(manifest))
        self.app.state.catalog.import_manifest(self.manifest)
        with patch.object(FixtureGemini, "describe", return_value=Description.model_validate(DESCRIPTION)) as describe:
            self.assertEqual(self.client.post("/artworks/sample/narration").status_code, 200)
            self.assertEqual(describe.call_count, 1)
            self.assertEqual(describe.call_args.args[1]["title"], "새 제목")

    def test_failed_narration_is_not_saved(self):
        with patch.object(FixtureGemini, "describe", return_value=FallbackDescription(**DESCRIPTION)):
            self.assertTrue(self.client.post("/artworks/sample/narration").json()["fallback"])
        with patch.object(FixtureGemini, "describe", return_value=Description.model_validate(DESCRIPTION)) as describe:
            self.assertFalse(self.client.post("/artworks/sample/narration").json()["fallback"])
            self.assertEqual(describe.call_count, 1)

    def test_generated_narration_fallback_is_not_playable(self):
        fallback = FallbackDescription(facts=["해설을 생성하지 못했습니다."], interpretations=[], regions=[], mood_keywords=[])
        with patch.object(FixtureGemini, "describe", return_value=fallback):
            response = self.client.post("/artworks/sample/narration")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["fallback"])
        self.assertEqual(response.json()["segments"], [])
        self.assertEqual(response.json()["text"], "")

    def test_generated_narration_errors_and_shared_ai_rate_limit(self):
        self.assertEqual(self.client.post("/artworks/missing/narration").status_code, 404)
        with patch.object(FixtureGemini, "describe", side_effect=HTTPException(503, "AI 설정 필요")):
            self.assertEqual(self.client.post("/artworks/sample/narration").status_code, 503)
        with patch.object(FixtureGemini, "describe", return_value=FallbackDescription(**DESCRIPTION)):
            for _ in range(4):
                self.assertEqual(self.client.post("/artworks/sample/narration").status_code, 200)
        self.assertEqual(self.client.post("/artworks/sample/narration").status_code, 429)
        # The existing analyze route shares that same limit.
        self.assertEqual(self.client.post("/analyze", files={"image": ("x.png", self.image, "image/png")}).status_code, 429)

    def test_threshold_rejection_and_boundary(self):
        self.app.state.recognition.match_threshold = 0.71
        response = self.client.post("/recognize", headers=self.headers, files={"image": ("x.png", self.image)})
        self.assertEqual(response.json()["status"], "no_match")
        self.assertEqual(response.json()["candidates"], [])
        self.assertEqual(response.json()["match_threshold"], 0.71)
        self.app.state.recognition.match_threshold = 0.7
        response = self.client.post("/recognize", headers=self.headers, files={"image": ("x.png", self.image)})
        self.assertEqual(response.json()["status"], "needs_confirmation")
        self.app.state.recognition.match_threshold = 0.99
        response = self.client.post("/recognize", headers=self.headers, data={"mode": "placard"}, files={"image": ("x.png", self.image)})
        self.assertIsNone(response.json()["match_threshold"])
        self.assertTrue(response.json()["candidates"])

    def test_fallback_flag(self):
        with patch.object(FixtureGemini, "describe", return_value=FallbackDescription(**DESCRIPTION)):
            response = self.client.post("/analyze", headers=self.headers, files={"image": ("x.png", self.image)})
        self.assertTrue(response.json()["fallback"])
        self.assertNotIn("fallback", response.json()["description"])

    def test_correction_validation_and_default_implementation(self):
        self.assertEqual(self.client.post("/correction").status_code, 422)
        # 프로필은 기기에만 저장하므로 요청마다 보내야 한다.
        self.assertEqual(self.client.post("/correction", data={"artwork_id": "sample"}).status_code, 422)
        data = {"artwork_id": "sample", "profile": "{}"}
        # Backend/ai/correction.py가 구현되어 기본 보정 함수로 JPEG를 반환한다.
        response = self.client.post("/correction", data=data)
        self.assertEqual((response.status_code, response.headers["content-type"]), (200, "image/jpeg"))
        self.assertEqual(self.client.post("/correction", data={**data, "artwork_id": "missing"}).status_code, 404)
        self.assertEqual(self.client.post("/correction", data={**data, "profile": '{"brightness":51}'}).status_code, 422)
        self.assertEqual(self.client.post("/correction", data=data, files={"image": ("x.png", self.image)}).status_code, 422)

    def test_corrector_contract_and_jpeg_response(self):
        captured = []

        def corrector(content, profile):
            captured.append(profile)
            return content

        app = create_app(self.root / "correction-data", corrector=corrector)
        with TestClient(app) as client:
            response = client.post("/correction", data={"profile": '{"brightness":20}'}, files={"image": ("x.png", self.image)})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers["content-type"], "image/jpeg")
            self.assertEqual(response.headers["cache-control"], "no-store")
            with Image.open(BytesIO(response.content)) as image:
                self.assertEqual(image.size, (16, 8))
            self.assertEqual(captured[0]["brightness"], 20)
            app.state.catalog.import_manifest(self.manifest)
            response = client.post("/correction", data={"artwork_id": "sample", "profile": '{"edge":0.4}'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(captured[-1]["edge"], 0.4)
        for invalid in [b"invalid", self.image, "not bytes"]:
            with self.assertRaises(HTTPException) as error:
                correct_jpeg(self.image, AIProfile(), lambda content, profile: invalid)
            self.assertEqual(error.exception.status_code, 502)

    def test_narration_uses_query_mode_and_hides_pending(self):
        # 로그인 없이 기기에 저장한 감상 모드를 쿼리로 보낸다. 생략하면 both.
        response = self.client.get("/artworks/sample/narration?mode=facts")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], DESCRIPTION["facts"][0])
        self.assertNotIn(DESCRIPTION["interpretations"][0], response.json()["text"])
        response = self.client.get("/artworks/sample/narration?mode=interpretations")
        self.assertIn("가능한 감정적 해석", response.json()["text"])
        response = self.client.get("/artworks/sample/narration")
        self.assertEqual(response.json()["mode"], "both")
        self.assertIn(DESCRIPTION["facts"][0], response.json()["text"])
        self.seed("pending")
        self.assertEqual(self.client.get("/artworks/sample/narration").status_code, 409)
        self.assertEqual(self.client.get("/artworks/missing/narration").status_code, 404)


class GeminiTests(unittest.TestCase):
    def setUp(self):
        self.service = GeminiService()
        self.service.key = "test-key"
        self.service.model = "test-model"
        with Image.new("RGB", (16, 8)) as image:
            stream = BytesIO()
            image.save(stream, format="JPEG")
        self.content = stream.getvalue()

    def response(self, data):
        return BytesIO(json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(data)}]}}]}).encode())

    def test_structured_result_and_api_key_header(self):
        with patch("Backend.gemini.urlopen", return_value=self.response(DESCRIPTION)) as transport:
            result = self.service.describe(self.content)
        self.assertEqual(result.facts, DESCRIPTION["facts"])
        request = transport.call_args.args[0]
        self.assertNotIn("test-key", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "test-key")
        self.assertIn("responseJsonSchema", json.loads(request.data)["generationConfig"])

    def test_generated_region_links_and_invalid_reference_retry(self):
        data = {**DESCRIPTION,
                "regions": [{"label": "형태", "bbox": [0, 0, 0.5, 0.5], "color": "빨강"}],
                "fact_region_indices": [0], "interpretation_region_indices": [None]}
        with patch("Backend.gemini.urlopen", return_value=self.response(data)):
            result = self.service.describe(self.content)
        self.assertEqual(result.fact_region_indices, [0])
        invalid = {**data, "fact_region_indices": [1]}
        with patch("Backend.gemini.urlopen", side_effect=[self.response(invalid), self.response(data)]) as transport:
            result = self.service.describe(self.content)
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(result.fact_region_indices, [0])

    def test_missing_configuration_and_malformed_response(self):
        self.service.key = ""
        with self.assertRaises(HTTPException) as error:
            self.service.describe(self.content)
        self.assertEqual(error.exception.status_code, 503)
        self.service.key = "test-key"
        with patch("Backend.gemini.urlopen", side_effect=[self.response({}), self.response({})]) as transport:
            result = self.service.describe(self.content)
        self.assertTrue(result.fallback)
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(result.regions, [])

    def test_schema_retry_can_recover(self):
        with patch("Backend.gemini.urlopen", side_effect=[self.response({}), self.response(DESCRIPTION)]) as transport:
            result = self.service.describe(self.content)
        self.assertFalse(getattr(result, "fallback", False))
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(result.facts, DESCRIPTION["facts"])

    def test_placard_invalid_json_still_errors_after_retry(self):
        with patch("Backend.gemini.urlopen", side_effect=[self.response({}), self.response({})]) as transport:
            with self.assertRaises(HTTPException) as raised:
                self.service.read_placard(self.content)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(transport.call_count, 2)

    def test_quota_error_is_sanitized(self):
        error = HTTPError("https://example.com", 429, "quota", {}, BytesIO(b"private provider detail"))
        with patch("Backend.gemini.urlopen", side_effect=error):
            with self.assertRaises(HTTPException) as raised:
                self.service.describe(self.content)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertNotIn("private", raised.exception.detail)

    def test_timeout(self):
        with patch("Backend.gemini.urlopen", side_effect=TimeoutError):
            with self.assertRaises(HTTPException) as error:
                self.service.describe(self.content)
        self.assertEqual(error.exception.status_code, 504)
