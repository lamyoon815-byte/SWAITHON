"""FE 9.2 계약: 미술관 마이그레이션·영역 연결·자동 촬영 동시 요청."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from threading import Event
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from pydantic import ValidationError

from Backend.catalog import ArtworkMetadata, Description, CatalogStore
from Backend.framing import locate_artwork, framing_hint
from Backend.tests import test_ai_routes as fixtures

DESCRIPTION = fixtures.DESCRIPTION


class FEContractTests(unittest.TestCase):
    setUp = fixtures.AIRouteTests.setUp
    seed = fixtures.AIRouteTests.seed

    def test_confidence_default_calibrated_and_rejected(self):
        def call():
            return self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)})
        self.assertEqual(call().json()['confidence'], 'medium')
        self.app.state.recognition.match_threshold = 0.5
        self.app.state.recognition.high_confidence_threshold = 0.7
        result = call().json()
        self.assertEqual((result['confidence'], result['status']), ('high', 'matched'))
        self.app.state.recognition.high_confidence_threshold = 0.8
        self.assertEqual(call().json()['confidence'], 'medium')
        self.app.state.recognition.match_threshold = 0.71
        result = call().json()
        self.assertEqual((result['confidence'], result['status'], result['candidates']), ('low', 'no_match', []))

    def test_web_can_read_retry_after(self):
        response = self.client.get('/museums', headers={'Origin': 'http://localhost:8081'})
        self.assertIn('Retry-After', response.headers['access-control-expose-headers'])

    def test_narration_region_mapping_with_mode_filter(self):
        description = {**DESCRIPTION, 'regions': [{'label': '형태', 'bbox': [0.1, 0.1, 0.5, 0.5], 'color': '빨강'}],
                       'fact_region_indices': [0], 'interpretation_region_indices': [None]}
        data = json.loads(self.manifest.read_text())
        data[0]['description'] = description
        self.manifest.write_text(json.dumps(data))
        self.app.state.catalog.import_manifest(self.manifest)
        segments = self.client.get('/artworks/sample/narration', headers=self.headers).json()['segments']
        self.assertEqual([s['region_index'] for s in segments], [0, None])
        segments = self.client.get('/artworks/sample/narration?mode=interpretations', headers=self.headers).json()['segments']
        self.assertEqual([s['region_index'] for s in segments], [None])
        self.seed('reviewed')
        self.assertTrue(all(s['region_index'] is None for s in self.client.get('/artworks/sample/narration', headers=self.headers).json()['segments']))
        for indices in [[1], [-1], []]:
            with self.assertRaises(ValidationError):
                Description.model_validate({**description, 'fact_region_indices': indices})

    def test_busy_rejected_without_queue_and_slot_released_after_failure(self):
        entered, release = Event(), Event()
        def slow(content):
            entered.set()
            if not release.wait(10):
                raise RuntimeError('test timeout')
            raise RuntimeError('inference failed')
        def call():
            return self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)})
        with patch.object(self.app.state.recognition, 'recognize_artwork', side_effect=slow):
            with ThreadPoolExecutor(1) as pool:
                first = pool.submit(call)
                try:
                    self.assertTrue(entered.wait(5))
                    second = call()
                    self.assertEqual(second.status_code, 503)
                    self.assertEqual(second.headers['Retry-After'], '2')
                finally:
                    release.set()
                with self.assertRaises(RuntimeError):
                    first.result()
        self.assertEqual(call().status_code, 200)

    def test_one_hz_allowed_and_over_limit_has_retry_after(self):
        now = [1000.0]
        # accounts.time은 같은 Python time 모듈이므로 monotonic만 시간 진행시킨다.
        with patch('Backend.accounts.time.monotonic', side_effect=lambda: now[0]):
            for _ in range(65):
                response = self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)})
                self.assertEqual(response.status_code, 200, response.text)
                now[0] += 1
            # 아직 윈도 내 59개, 1개 추가 후 다음 요청 차단.
            response = self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)})
            self.assertEqual(response.status_code, 200)
            response = self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)})
            self.assertEqual(response.status_code, 429)
            self.assertIn('Retry-After', response.headers)

    def test_location_is_exposed_only_for_artwork_candidate(self):
        location = {'artwork_bbox': [0.1, 0.2, 0.4, 0.5], 'framing_hint': 'move_left'}
        with patch('Backend.ai_routes.locate_artwork', return_value=location):
            result = self.client.post('/recognize', headers=self.headers, files={'image': ('x.png', self.image)}).json()
            self.assertEqual(result['quality']['artwork_bbox'], location['artwork_bbox'])
            result = self.client.post('/recognize', headers=self.headers, data={'mode': 'placard'}, files={'image': ('x.png', self.image)}).json()
            self.assertIsNone(result['quality']['artwork_bbox'])
            self.assertIsNone(result['quality']['framing_hint'])


class MuseumContractTests(unittest.TestCase):
    def test_legacy_migration_and_ids(self):
        with TemporaryDirectory() as directory:
            store = CatalogStore(Path(directory))
            store.initialize()
            legacy = {'id': 'a', 'title': '작품', 'artist': '작가', 'museum': '미술관', 'number': '007'}
            with sqlite3.connect(store.db_path) as db:
                db.execute('INSERT INTO artworks VALUES (?, ?, ?)', ('a', json.dumps(legacy), 'unused.png'))
            # sqlite3의 컨텍스트는 commit만 하므로 Windows 임시 DB 삭제 전에 명시적으로 닫는다.
            db.close()
            store.initialize()
            museum_id = store.get('a')['museum_id']
            self.assertEqual(store.museums(20, 0)['items'][0]['id'], museum_id)
            self.assertEqual(len(store.find_by_number('007', museum_id=museum_id)), 1)
            self.assertEqual(store.list(20, 0, museum_id)[1], 1)
            self.assertEqual(store.list(20, 0, 'missing')[1], 0)
            store.initialize()
            self.assertEqual(store.get('a')['museum_id'], museum_id)

    def test_museum_id_requires_name(self):
        with self.assertRaises(ValidationError):
            ArtworkMetadata(id='a', title='작품', artist='작가', museum_id='museum')


class FramingTests(unittest.TestCase):
    def png(self, pixels):
        stream = BytesIO()
        Image.fromarray(pixels).save(stream, format='PNG')
        return stream.getvalue()

    def test_localizes_textured_artwork_in_larger_photo(self):
        rng = np.random.default_rng(42)
        # ORB에서 충분히 구분되는 특징점이 있는 합성 원본과 위치가 알려진 촬영본.
        texture = rng.integers(0, 256, (320, 320), dtype=np.uint8)
        photo = np.full((600, 800), 230, dtype=np.uint8)
        photo[140:460, 40:360] = texture
        result = locate_artwork(self.png(photo), self.png(texture))
        self.assertIsNotNone(result)
        for actual, expected in zip(result['artwork_bbox'], [0.05, 140/600, 0.4, 320/600]):
            self.assertAlmostEqual(actual, expected, delta=0.02)
        self.assertEqual(result['framing_hint'], 'move_left')
        blank = self.png(np.full((320, 320), 200, dtype=np.uint8))
        self.assertIsNone(locate_artwork(blank, self.png(texture)))
        unrelated = self.png(rng.integers(0, 256, (600, 800), dtype=np.uint8))
        self.assertIsNone(locate_artwork(unrelated, self.png(texture)))

    def test_framing_hints_are_camera_movement(self):
        self.assertEqual(framing_hint([0.05, 0.3, 0.2, 0.4]), 'move_left')
        self.assertEqual(framing_hint([0.75, 0.3, 0.2, 0.4]), 'move_right')
        self.assertEqual(framing_hint([0.4, 0.4, 0.2, 0.2]), 'move_closer')
