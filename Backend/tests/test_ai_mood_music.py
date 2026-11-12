"""작품 분위기 분류·음악 폴더 만들기(Backend/ai/mood_music.py): 네트워크·CLIP 없이 가짜로 확인한다."""
import csv
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import numpy as np

from Backend.ai import mood_music as mm

FAKE_MP3 = b"ID3" + b"\x00" * 200_000


class FakeEncoder:
    """분위기 i의 설명 문장은 축 i 방향, 이미지는 내용(b"cat:<i>")에 적힌 축 방향 벡터로 만든다."""
    dim = 16

    def encode_texts(self, texts):
        index = next(i for i, c in enumerate(mm.CATEGORIES) if c["prompts"] == texts)
        vectors = np.zeros((len(texts), self.dim), dtype=np.float32)
        vectors[:, index] = 1
        return vectors

    def encode(self, content):
        vector = np.full(self.dim, 0.05, dtype=np.float32)
        vector[int(content.decode().split(":")[1])] = 1
        return vector / np.linalg.norm(vector)


class MoodMusicTests(unittest.TestCase):
    def test_tracks_are_twenty_distinct_commons_mp3s(self):
        self.assertEqual(len(mm.CATEGORIES), 10)
        self.assertTrue(all(set(c["tracks"]) == set(mm.ENERGIES) and c["energy"] in mm.ENERGIES for c in mm.CATEGORIES))
        urls = [track["mp3"] for _, _, _, track in mm.all_tracks()]
        self.assertEqual(len(set(urls)), 20)
        files = [mm.music_file(i, c, e) for i, c, e, _ in mm.all_tracks()]
        self.assertEqual(len(set(files)), 20)
        self.assertEqual(files[:2], ["music/01_calm.mp3", "music/01_calm_lively.mp3"])  # 기본 곡은 원래 이름 그대로
        self.assertTrue(all(u.startswith("https://upload.wikimedia.org/wikipedia/commons/transcoded/") and u.endswith(".mp3") for u in urls))
        self.assertEqual(len({c["key"] for c in mm.CATEGORIES}), 10)

    def test_download_music_writes_and_skips_existing(self):
        with TemporaryDirectory() as directory:
            out, calls = Path(directory), []
            fetcher = lambda url, timeout: calls.append(url) or FAKE_MP3
            mm.time.sleep, sleep = (lambda s: None), mm.time.sleep
            try:
                mm.download_music(out, fetcher)
                self.assertEqual(sorted(p.name for p in (out / "music").iterdir())[0], "01_calm.mp3")
                self.assertEqual(len(calls), 20)
                self.assertIn("CC BY 4.0", (out / "music" / "CREDITS.md").read_text(encoding="utf-8"))
                mm.download_music(out, fetcher)  # 이미 받은 파일은 다시 받지 않는다.
                self.assertEqual(len(calls), 20)
                (out / "music" / "01_calm.mp3").unlink()
                with self.assertRaises(SystemExit) as caught:
                    mm.download_music(out, lambda url, timeout: b"<html>not audio</html>")
                self.assertIn("calm", str(caught.exception))
                # 한 곡이 계속 실패해도 나머지는 받고, 실패한 곡만 알려 준다.
                for path in (out / "music").iterdir():
                    path.unlink()
                def flaky(url, timeout):
                    if "Bach" in url:  # 바흐 두 곡(경건·평온)
                        raise OSError("connection reset")
                    return FAKE_MP3
                with self.assertRaises(SystemExit) as caught:
                    mm.download_music(out, flaky)
                self.assertIn("sacred-lively", str(caught.exception))
                self.assertEqual(len(list((out / "music").glob("*.mp3"))), 18)
                # 429 뒤 성공하면 다시 받아서 저장한다.
                from urllib.error import HTTPError
                attempts = []
                def limited(url, timeout):
                    attempts.append(url)
                    if len(attempts) == 1:
                        raise HTTPError(url, 429, "Too Many Requests", {"Retry-After": "0"}, None)
                    return FAKE_MP3
                mm.download_music(out, limited)
                self.assertEqual(len(attempts), 3)  # 실패했던 두 곡 + 429로 한 번 다시 받음
                self.assertEqual(len(list((out / "music").glob("*.mp3"))), 20)
            finally:
                mm.time.sleep = sleep

    def test_classify_and_korean_bonus(self):
        matrix = mm.category_matrix(FakeEncoder())
        encoder = FakeEncoder()
        calm = encoder.encode(b"cat:0")
        self.assertEqual(mm.CATEGORIES[mm.classify(calm, matrix)[0]]["key"], "calm")
        korean = [c["key"] for c in mm.CATEGORIES].index("korean")
        # 평온과 한국 전통이 거의 같은 그림: 한국 전통 미술관 작품이면 한국 전통으로
        close = np.zeros(16, dtype=np.float32); close[0] = 1.0; close[korean] = 0.98
        close /= np.linalg.norm(close)
        self.assertEqual(mm.CATEGORIES[mm.classify(close, matrix, "met")[0]]["key"], "calm")
        self.assertEqual(mm.CATEGORIES[mm.classify(close, matrix, "nmk")[0]]["key"], "korean")
        self.assertAlmostEqual(float(mm.classify(calm, matrix)[1].sum()), 1.0, places=5)

    def test_end_to_end_outputs_follow_integration_format(self):
        items = [{"id": f"aic-{i}", "sha256": f"h{i}", "title": f"작품{i}", "artist": "작가", "museum_id": "aic",
                  "image_url": f"http://server/images/{i}.jpg", "image_path": f"images/{i}.jpg"} for i in range(10)]
        items.append({"id": "aic-bad", "title": "깨진 그림", "image_url": "http://server/images/bad.jpg", "image_path": "x"})
        def fetcher(url, timeout):
            if "bad" in url:
                raise OSError("404")
            return f"cat:{url.rsplit('/', 1)[1].split('.')[0]}".encode()
        with TemporaryDirectory() as directory:
            out = Path(directory)
            encoder = FakeEncoder()
            vectors, failed = mm.encode_all(items, encoder, out, fetcher=fetcher, workers=2)
            self.assertEqual((len(vectors), [f[0] for f in failed]), (10, ["aic-bad"]))
            # 다시 실행하면 캐시를 써서 이미지를 다시 받지 않는다.
            again, _ = mm.encode_all(items[:10], encoder, out, fetcher=lambda u, t: self.fail("다시 받음"))
            self.assertEqual(len(again), 10)
            counts, _ = mm.write_outputs(out, items, vectors, mm.category_matrix(encoder), failed)
            manifest = json.loads((out / "music_manifest.json").read_text(encoding="utf-8"))
            first = manifest["items"][0]
            self.assertEqual((first["artwork_id"], first["music_file"]), ("aic-0", "music/01_calm.mp3"))
            self.assertEqual(manifest["items"][9]["music_file"], "music/10_korean.mp3")
            self.assertEqual(manifest["failed"][0]["artwork_id"], "aic-bad")
            self.assertTrue(all(count == 1 for count in counts.values()))
            categories = json.loads((out / "categories.json").read_text(encoding="utf-8"))
            self.assertEqual([c["count"] for c in categories], [1] * 10)
            with (out / "review.csv").open(encoding="utf-8-sig") as file:
                self.assertEqual(len(list(csv.reader(file))), 11)
            self.assertIn("CC BY 4.0", mm.credits_markdown())


if __name__ == "__main__":
    unittest.main()


class MusicVolumeTests(unittest.TestCase):
    def test_every_track_has_loudness_and_quiet_tracks_play_louder(self):
        from Backend.ai.mood_music import all_tracks, music_file
        from Backend.ai.mood_routes import MUSIC_LOUDNESS_DBFS, music_volume
        names = {Path(music_file(index, category, energy)).name for index, category, energy, _ in all_tracks()}
        self.assertEqual(names, set(MUSIC_LOUDNESS_DBFS))
        # 짐노페디(-35dBFS)는 크게, 구아리랑(-17.8dBFS)은 작게 틀어 둘이 비슷하게 들린다.
        self.assertGreater(music_volume("01_calm.mp3"), 0.8)
        self.assertLess(music_volume("10_korean.mp3"), 0.15)
        self.assertGreater(music_volume("01_calm.mp3"), music_volume("10_korean.mp3") * 5)
        self.assertEqual(music_volume("03_bright_soft.mp3"), 1.0)  # 1을 넘을 수 없다
        self.assertEqual(music_volume("unknown.mp3"), 0.25)
