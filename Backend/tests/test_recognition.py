from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import numpy as np
from PIL import Image

from Backend.catalog import CatalogStore
from Backend.recognition import RecognitionService, image_quality


class FixtureEncoder:
    """검색·인덱스 계약 테스트용. CLIP 정확도 검증을 대신하지 않는다."""
    model_name = "fixture"
    pretrained = "fixture"

    def encode(self, content):
        with Image.open(BytesIO(content)) as image:
            vector = np.asarray(image.convert("RGB"), dtype=np.float32).mean(axis=(0, 1))
        return vector / max(np.linalg.norm(vector), 1)


class RecognitionTests(unittest.TestCase):
    def test_threshold_configuration_validation(self):
        with patch.dict("os.environ", {"CLIP_MATCH_THRESHOLD": "0.42"}):
            with TemporaryDirectory() as directory:
                service = RecognitionService(CatalogStore(Path(directory)), encoder=FixtureEncoder())
                self.assertEqual(service.match_threshold, 0.42)
        for value in ["nan", "inf", "1.1", "-1.1", "invalid"]:
            with patch.dict("os.environ", {"CLIP_MATCH_THRESHOLD": value}), TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    RecognitionService(CatalogStore(Path(directory)), encoder=FixtureEncoder())

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = CatalogStore(self.root / "data")
        self.store.initialize()
        self.records = []
        for name in ["red", "green", "blue", "yellow"]:
            with Image.new("RGB", (16, 8), name) as image:
                image.save(self.root / f"{name}.png")
            self.records.append({"id": name, "title": name, "artist": "artist", "image_path": f"{name}.png"})
        self.manifest = self.root / "catalog.json"
        self.manifest.write_text(json.dumps(self.records))
        self.store.import_manifest(self.manifest)
        self.service = RecognitionService(self.store, FixtureEncoder())

    def test_build_search_rank_and_top_three(self):
        self.assertEqual(self.service.build_index(), 4)
        matches = self.service.recognize_artwork((self.root / "blue.png").read_bytes())
        self.assertEqual(len(matches), 3)
        self.assertEqual(matches[0]["artwork_id"], "blue")
        self.assertAlmostEqual(matches[0]["score"], 1)

    def test_missing_stale_and_mismatched_index(self):
        content = (self.root / "red.png").read_bytes()
        with self.assertRaises(HTTPException) as raised:
            self.service.recognize_artwork(content)
        self.assertEqual(raised.exception.status_code, 503)
        self.service.build_index()
        self.service.encoder.pretrained = "different"
        with self.assertRaises(HTTPException):
            self.service.recognize_artwork(content)
        self.service.encoder.pretrained = "fixture"
        self.manifest.write_text(json.dumps(self.records[:-1]))
        # 카탈로그에 새 ID를 추가하여 오래된 인덱스를 감지한다.
        self.manifest.write_text(json.dumps([*self.records, {**self.records[0], "id": "new"}]))
        self.store.import_manifest(self.manifest)
        with self.assertRaises(HTTPException):
            self.service.recognize_artwork(content)

    def test_placard_matching_and_empty_ocr(self):
        matches = self.service.match_placard("blue", "artist", "blue artist")
        self.assertEqual(matches[0]["artwork_id"], "blue")
        self.assertEqual(self.service.match_placard("", "", ""), [])

    def test_quality_metrics_are_finite(self):
        quality = image_quality((self.root / "red.png").read_bytes())
        self.assertGreaterEqual(quality["laplacian_variance"], 0)
        self.assertGreaterEqual(quality["highlight_ratio"], 0)
        self.assertLessEqual(quality["highlight_ratio"], 1)
