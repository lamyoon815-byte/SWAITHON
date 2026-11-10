"""AI 파트(작품 판별·결과 분기·예산·어댑터·API 분리) 계약 테스트. 실제 CLIP 정확도 검증은 evaluation.py로 한다."""
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

from Backend.ai.adapter import ClipAdapter, load_optional_adapter
from Backend.ai.artwork_gate import ARTWORK_PROMPTS, NON_ARTWORK_PROMPTS, ArtworkGate
from Backend.ai.budget import GeminiBudget
from Backend.ai.decision import decide
from Backend.catalog import CatalogStore, Description
from Backend.gemini import PlacardText
from Backend.main import create_app
from Backend.recognition import RecognitionService


class DecisionTests(unittest.TestCase):
    def test_registered_match_wins_over_gate(self):
        result = decide([0.9], match_threshold=0.8, high_threshold=0.85, artwork_probability=0.1, gate_threshold=0.5)
        self.assertEqual((result["status"], result["next_action"]), ("matched", "show_artwork"))
        result = decide([0.82], match_threshold=0.8, high_threshold=0.85, artwork_probability=0.9, gate_threshold=0.5)
        self.assertEqual((result["status"], result["next_action"]), ("needs_confirmation", "confirm_candidates"))

    def test_not_artwork_asks_retake_with_quality_hint(self):
        result = decide([0.5], match_threshold=0.8, artwork_probability=0.2, gate_threshold=0.5,
                        quality_warnings=["흐릴 수 있습니다."])
        self.assertEqual((result["reason"], result["next_action"]), ("not_artwork", "retake"))
        self.assertIn("인식하지 못했어요", result["message"])
        self.assertIn("흐릴 수 있습니다.", result["message"])
        self.assertFalse(result["keep_candidates"])

    def test_unregistered_artwork_goes_to_analyze(self):
        result = decide([0.5], match_threshold=0.8, artwork_probability=0.9, gate_threshold=0.5)
        self.assertEqual((result["status"], result["reason"], result["next_action"]),
                         ("no_match", "unregistered_artwork", "analyze"))

    def test_uncalibrated_keeps_confirmation_but_still_filters_non_artwork(self):
        self.assertEqual(decide([0.5], artwork_probability=0.9, gate_threshold=0.5)["next_action"], "confirm_candidates")
        self.assertEqual(decide([0.5], artwork_probability=0.1, gate_threshold=0.5)["next_action"], "retake")
        self.assertEqual(decide([0.5])["next_action"], "confirm_candidates")


class BudgetTests(unittest.TestCase):
    def test_budget_blocks_before_exceeding(self):
        with TemporaryDirectory() as directory:
            budget = GeminiBudget(Path(directory) / "usage.json", budget_krw=20, input_usd_per_m=0.25,
                                  output_usd_per_m=1.5, krw_per_usd=1500, max_input_tokens=4000, daily_limit=0)
            self.assertAlmostEqual(budget.worst_case_call_krw, 10.716, places=3)
            budget.reserve()
            budget.record({"promptTokenCount": 2000, "candidatesTokenCount": 1000})  # 0.75 + 2.25 = 3원
            self.assertAlmostEqual(budget.summary()["spent_krw"], 3.0, places=1)
            budget.reserve()
            budget.record(None)  # 토큰 수를 모르면 최대 비용으로 기록
            with self.assertRaises(HTTPException) as caught:
                budget.reserve()
            self.assertEqual(caught.exception.status_code, 429)

    def test_daily_limit(self):
        with TemporaryDirectory() as directory:
            budget = GeminiBudget(Path(directory) / "usage.json", budget_krw=1000, daily_limit=1)
            budget.reserve()
            with self.assertRaises(HTTPException):
                budget.reserve()


def random_adapter(dim=4, hidden=2, alpha=0.5, model="fixture"):
    rng = np.random.default_rng(0)
    return ClipAdapter(rng.normal(size=(dim, hidden)), np.zeros(hidden), rng.normal(size=(hidden, dim)),
                       np.zeros(dim), alpha, model, "fixture")


class AdapterTests(unittest.TestCase):
    def test_apply_save_load_roundtrip(self):
        adapter = random_adapter()
        vectors = np.eye(4, dtype=np.float32)
        adapted = adapter.apply(vectors)
        np.testing.assert_allclose(np.linalg.norm(adapted, axis=1), 1, rtol=1e-5)
        np.testing.assert_allclose(adapter.apply(vectors[0]), adapted[0], rtol=1e-5)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "clip-adapter.npz"
            adapter.save(path)
            loaded = load_optional_adapter(path, "fixture", "fixture")
            self.assertEqual(loaded.fingerprint, adapter.fingerprint)
            with self.assertWarns(UserWarning):
                self.assertIsNone(load_optional_adapter(path, "other-model", "fixture"))
            self.assertIsNone(load_optional_adapter(path, "fixture", "fixture", enabled=False))
            self.assertIsNone(load_optional_adapter(Path(directory) / "missing.npz", "fixture", "fixture"))

    def test_alpha_zero_is_identity(self):
        adapter = random_adapter(alpha=0)
        vector = np.array([0.6, 0.8, 0, 0], dtype=np.float32)
        np.testing.assert_allclose(adapter.apply(vector), vector, rtol=1e-6)


class TextEncoder:
    """문장 임베딩을 지원하는 테스트용 인코더. 빨간 이미지는 '작품', 초록 이미지는 '손' 문장과 가깝게 만든다."""
    model_name = "fixture"
    pretrained = "fixture"

    def encode(self, content):
        with Image.open(BytesIO(content)) as image:
            r, g, b = np.asarray(image.convert("RGB"), dtype=np.float32).mean(axis=(0, 1))
        vector = np.array([r, g, b + 1, 1], dtype=np.float32)
        return vector / np.linalg.norm(vector)

    def encode_texts(self, texts):
        vectors = []
        for text in texts:
            vectors.append([1, 0, 0, 0] if text in ARTWORK_PROMPTS else [0, 1, 0, 0])
        return np.array(vectors, dtype=np.float32)


def png(color):
    with Image.new("RGB", (16, 8), color) as image:
        stream = BytesIO()
        image.save(stream, format="PNG")
    return stream.getvalue()


class GateAndServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = CatalogStore(self.root / "data")
        self.store.initialize()
        (self.root / "red.png").write_bytes(png("red"))
        manifest = self.root / "catalog.json"
        manifest.write_text(json.dumps([{"id": "red", "title": "red", "artist": "a", "image_path": "red.png"}]))
        self.store.import_manifest(manifest)

    def test_gate_probability(self):
        gate = ArtworkGate(TextEncoder(), 0.5)
        self.assertGreater(gate.artwork_probability(TextEncoder().encode(png("red"))), 0.5)
        self.assertLess(gate.artwork_probability(TextEncoder().encode(png("lime"))), 0.5)
        self.assertEqual(len(gate._texts()), len(ARTWORK_PROMPTS) + len(NON_ARTWORK_PROMPTS))
        with self.assertRaises(ValueError):
            ArtworkGate(TextEncoder(), 1.5)

    def test_service_returns_probability_and_adapter_requires_rebuild(self):
        service = RecognitionService(self.store, encoder=TextEncoder())
        service.build_index()
        found = service.recognize_photo(png("red"))
        self.assertEqual(found["candidates"][0]["artwork_id"], "red")
        self.assertGreater(found["artwork_probability"], 0.5)
        random_adapter().save(self.store.data_dir / "clip-adapter.npz")
        adapted = RecognitionService(self.store, encoder=TextEncoder())
        with self.assertRaises(HTTPException) as caught:
            adapted.recognize_photo(png("red"))
        self.assertEqual(caught.exception.status_code, 503)  # 어댑터가 바뀌면 인덱스를 다시 만들어야 한다.
        adapted.build_index()
        self.assertEqual(adapted.recognize_photo(png("red"))["candidates"][0]["artwork_id"], "red")
        with patch.dict("os.environ", {"CLIP_ADAPTER": "off", "ARTWORK_GATE_THRESHOLD": "off"}):
            plain = RecognitionService(self.store, encoder=TextEncoder())
        self.assertIsNone(plain.adapter)
        self.assertIsNone(plain.gate)


class FixtureGemini:
    def __init__(self):
        self.placard = PlacardText(title="작품", artist="작가", text="작품 작가")

    def read_placard(self, content):
        return self.placard

    def describe(self, content, metadata=None):
        return Description.model_validate({"facts": ["사실"], "interpretations": [], "regions": [], "mood_keywords": []})


class PhotoRecognition:
    def __init__(self):
        self.match_threshold, self.high_confidence_threshold, self.gate_threshold = 0.8, 0.9, 0.5
        self.score, self.probability = 0.95, 0.9

    def recognize_photo(self, content):
        return {"candidates": [{"artwork_id": "sample", "title": "작품", "artist": "작가", "score": self.score}],
                "artwork_probability": self.probability}

    def match_placard(self, title, artist, text):
        return [{"artwork_id": "sample", "title": title, "artist": artist, "score": 1}] if title else []


class SplitRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.recognition, self.gemini = PhotoRecognition(), FixtureGemini()
        self.app = create_app(root / "data", recognition=self.recognition, gemini=self.gemini)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.image = png("red")
        (root / "sample.png").write_bytes(self.image)
        manifest = root / "catalog.json"
        manifest.write_text(json.dumps([{"id": "sample", "title": "작품", "artist": "작가", "image_path": "sample.png"}]))
        self.app.state.catalog.import_manifest(manifest)

    def post(self, path):
        return self.client.post(path, files={"image": ("x.png", self.image)}).json()

    def test_artwork_route_branches(self):
        self.assertEqual(self.post("/recognize/artwork")["next_action"], "show_artwork")
        self.recognition.score = 0.5
        body = self.post("/recognize/artwork")
        self.assertEqual((body["reason"], body["next_action"], body["candidates"]), ("unregistered_artwork", "analyze", []))
        self.recognition.probability = 0.1
        body = self.post("/recognize/artwork")
        self.assertEqual((body["reason"], body["next_action"]), ("not_artwork", "retake"))
        self.assertTrue(body["message"])
        self.assertEqual(body["artwork_probability"], 0.1)

    def test_placard_route_and_legacy_route(self):
        self.assertEqual(self.post("/recognize/placard")["next_action"], "confirm_candidates")
        self.gemini.placard = PlacardText(title="", artist="", text="")
        body = self.post("/recognize/placard")
        self.assertEqual((body["reason"], body["next_action"]), ("placard_unreadable", "retake"))
        legacy = self.client.post("/recognize", files={"image": ("x.png", self.image)}).json()
        self.assertEqual(legacy["mode"], "artwork")
        schema = self.client.get("/openapi.json").json()["paths"]
        self.assertTrue(schema["/recognize"]["post"].get("deprecated"))
        self.assertIn("/recognize/artwork", schema)
        self.assertIn("/recognize/placard", schema)


if __name__ == "__main__":
    unittest.main()


class IPhoneImageTests(unittest.TestCase):
    def test_mpo_photo_is_accepted(self):
        """아이폰 사진은 Pillow에서 MPO 형식으로 열린다. 서버가 거부하지 않아야 한다."""
        from Backend.images import normalize_image
        stream = BytesIO()
        Image.new("RGB", (32, 24), "red").save(stream, format="MPO", save_all=True,
                                                 append_images=[Image.new("RGB", (32, 24), "blue")])
        with Image.open(BytesIO(stream.getvalue())) as check:
            self.assertEqual(check.format, "MPO")
        result = normalize_image(stream.getvalue())
        self.assertEqual((result.source_format, result.width, result.height), ("MPO", 32, 24))
