import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient
from PIL import Image

from Backend.catalog import CatalogStore
from Backend.main import create_app


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data_dir = self.root / "data"
        self.source = self.root / "sample.png"
        with Image.new("RGB", (16, 8), "red") as image:
            image.save(self.source)
        self.store = CatalogStore(self.data_dir)
        self.client = TestClient(create_app(self.data_dir))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def record(self, **changes):
        return {
            "id": "sample-artwork",
            "title": "테스트 작품",
            "artist": "테스트 작가",
            "image_path": "sample.png",
            **changes,
        }

    def import_records(self, records):
        manifest = self.root / "catalog.json"
        manifest.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
        return self.store.import_manifest(manifest)

    def test_empty_catalog_and_missing_artwork(self):
        response = self.client.get("/artworks")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response.json()["total"], 0)
        self.assertEqual(self.client.get("/artworks/missing").status_code, 404)
        self.assertEqual(self.client.get("/artworks/x' OR '1'='1").status_code, 404)

    def test_import_detail_and_original_bytes(self):
        self.assertEqual(self.import_records([self.record()]), 1)
        response = self.client.get("/artworks/sample-artwork")
        self.assertEqual(response.status_code, 200)
        record = response.json()
        self.assertEqual(record["title"], "테스트 작품")
        self.assertEqual(record["review_status"], "pending")
        self.assertIsNone(record["description"])
        self.assertNotIn("image_filename", record)
        image = self.client.get(record["image_url"])
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/png")
        self.assertEqual(image.content, self.source.read_bytes())
        self.assertEqual(self.client.get("/images/../catalog.sqlite3").status_code, 404)

    def test_pending_description_hidden_then_reviewed_description_visible(self):
        description = {
            "facts": ["테스트용 시각 정보"],
            "interpretations": [],
            "regions": [{"label": "영역", "bbox": [0.1, 0.1, 0.3, 0.3], "color": "빨강"}],
            "mood_keywords": [],
        }
        self.import_records([self.record(description=description)])
        self.assertIsNone(self.client.get("/artworks/sample-artwork").json()["description"])
        self.import_records([self.record(description=description, review_status="reviewed")])
        self.assertEqual(
            self.client.get("/artworks/sample-artwork").json()["description"],
            {**description, "fact_region_indices": None, "interpretation_region_indices": None}
        )

    def test_reimport_updates_without_duplicates_and_persists(self):
        self.import_records([self.record()])
        self.import_records([self.record(title="수정된 제목")])
        reopened_store = CatalogStore(self.data_dir)
        reopened_store.initialize()
        records, total = reopened_store.list(20, 0)
        self.assertEqual(total, 1)
        self.assertEqual(records[0]["title"], "수정된 제목")
        self.assertEqual(len(list(self.store.images_dir.iterdir())), 1)

    def test_bad_batch_does_not_partially_import(self):
        with self.assertRaises(FileNotFoundError):
            self.import_records([
                self.record(),
                self.record(id="missing", image_path="missing.png"),
            ])
        self.assertEqual(self.client.get("/artworks").json()["total"], 0)
        with self.assertRaises(ValueError):
            self.import_records([self.record(), self.record()])

    def test_pagination_and_input_validation(self):
        self.import_records([self.record(id="b"), self.record(id="a")])
        response = self.client.get("/artworks?limit=1&offset=1")
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual([item["id"] for item in response.json()["items"]], ["b"])
        self.assertEqual(self.client.get("/artworks?limit=101").status_code, 422)
        self.assertEqual(self.client.get("/artworks?offset=-1").status_code, 422)

    def test_find_by_number(self):
        self.import_records([self.record(number="007", museum="테스트 미술관")])
        response = self.client.get("/artworks/by-number", params={"number": "007"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "sample-artwork")
        self.assertEqual(response.json()["number"], "007")
        self.assertEqual(response.json()["museum"], "테스트 미술관")
        self.assertIn("image_url", response.json())
        self.assertEqual(self.client.get("/artworks/sample-artwork").json()["number"], "007")
        self.assertEqual(self.client.get("/artworks/by-number", params={"number": "7"}).status_code, 404)
        self.assertEqual(
            self.client.get("/artworks/by-number", params={"number": "007", "museum": "다른 미술관"}).status_code, 404
        )
        self.assertEqual(self.client.get("/artworks/by-number").status_code, 422)

    def test_same_number_in_two_museums_needs_museum(self):
        self.import_records([
            self.record(id="a", number="1", museum="가 미술관"),
            self.record(id="b", number="1", museum="나 미술관"),
        ])
        self.assertEqual(self.client.get("/artworks/by-number", params={"number": "1"}).status_code, 409)
        response = self.client.get("/artworks/by-number", params={"number": "1", "museum": "나 미술관"})
        self.assertEqual(response.json()["id"], "b")

    def test_duplicate_number_in_museum_is_rejected(self):
        self.import_records([self.record(id="a", number="1", museum="가 미술관")])
        with self.assertRaises(ValueError):
            self.import_records([self.record(id="b", number="1", museum="가 미술관")])
        self.assertEqual(self.client.get("/artworks").json()["total"], 1)
        # 한 번의 등록에서 번호를 맞바꾸는 갱신은 허용한다.
        self.import_records([self.record(id="b", number="2", museum="가 미술관")])
        self.import_records([
            self.record(id="a", number="2", museum="가 미술관"),
            self.record(id="b", number="1", museum="가 미술관"),
        ])
        response = self.client.get("/artworks/by-number", params={"number": "2"})
        self.assertEqual(response.json()["id"], "a")

    def test_records_without_number_are_still_valid(self):
        self.import_records([self.record(id="a"), self.record(id="b")])
        self.assertIsNone(self.client.get("/artworks/a").json()["number"])
        self.assertEqual(self.client.get("/artworks/by-number", params={"number": "1"}).status_code, 404)

    def test_museum_api_id_filter_and_number_uniqueness(self):
        self.assertEqual(self.client.get("/museums").json()["items"], [])
        self.import_records([
            self.record(id="a", museum_id="one", museum="가", number="007"),
            self.record(id="b", museum_id="two", museum="나", number="007"),
        ])
        result = self.client.get("/museums?limit=1&offset=1").json()
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["items"], [{"id": "two", "name": "나", "area": "", "artwork_count": 1}])
        response = self.client.get("/artworks/by-number", params={"museum_id": "one", "number": "007"})
        self.assertEqual(response.json()["id"], "a")
        self.assertEqual(self.client.get("/artworks?museum_id=two").json()["items"][0]["id"], "b")
        self.assertEqual(self.client.get("/artworks/by-number?museum_id=one&museum=나&number=007").status_code, 404)
        with self.assertRaises(ValueError):
            self.import_records([self.record(id="c", museum_id="one", museum="가", number="007")])
        with self.assertRaises(ValueError):
            self.import_records([self.record(id="c", museum_id="one", museum="다른 이름")])
        self.assertEqual(self.client.get("/museums?limit=101").status_code, 422)

    def test_museum_area_is_listed(self):
        self.import_records([self.record(id="a", museum_id="met", museum="메트로폴리탄 미술관", museum_area="미국 뉴욕")])
        self.assertEqual(self.client.get("/museums").json()["items"],
                         [{"id": "met", "name": "메트로폴리탄 미술관", "area": "미국 뉴욕", "artwork_count": 1}])
        with self.assertRaises(ValueError):
            self.import_records([self.record(id="b", museum_area="미국 뉴욕")])

    def test_upload_and_health_still_work(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        self.assertEqual(self.client.get("/docs").status_code, 200)
        response = self.client.post(
            "/upload", files={"image": ("sample.png", self.source.read_bytes(), "image/png")}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["format"], "JPEG")
        self.assertEqual(self.client.get("/artworks").json()["total"], 0)


if __name__ == "__main__":
    unittest.main()
