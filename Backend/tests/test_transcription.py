import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from Backend.transcription import OpenAITranscriptionService, create_transcription_router


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict("os.environ", {"OPENAI_API_KEY": "test-openai-key", "OPENAI_STT_MODEL": "gpt-4o-mini-transcribe"})
        self.env.start(); self.addCleanup(self.env.stop)
        self.calls = []

    def client(self, status=200, payload=None, raises=None):
        def post(url, body, headers, timeout):
            self.calls.append((url, body, headers))
            if raises: raise raises
            return status, json.dumps(payload if payload is not None else {"text": " 45 ", "usage": {"type": "tokens", "input_tokens": 80, "output_tokens": 3}}).encode()
        self.service = OpenAITranscriptionService(Path(self.temp.name), post)
        app = FastAPI()
        app.include_router(create_transcription_router(self.service))
        return TestClient(app)

    def send(self, client, content=b"fake-m4a", content_type="audio/m4a"):
        return client.post("/transcribe", files={"audio": ("answer.m4a", content, content_type)})

    def test_returns_trimmed_text_and_records_usage(self):
        response = self.send(self.client())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "45"})
        url, body, headers = self.calls[0]
        self.assertEqual(url, "https://api.openai.com/v1/audio/transcriptions")
        self.assertIn(b'name="model"\r\n\r\ngpt-4o-mini-transcribe', body)
        self.assertIn(b'name="language"\r\n\r\nko', body)
        self.assertIn(b"fake-m4a", body)
        self.assertEqual(headers["Authorization"], "Bearer test-openai-key")
        self.assertEqual(self.service.budget.summary()["calls"], 1)
        self.assertEqual(self.service.budget.pending_krw, 0)

    def test_upstream_error_releases_reservation(self):
        response = self.send(self.client(status=500, payload={"error": "boom"}))
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.service.budget.pending_krw, 0)
        self.assertEqual(self.service.budget.summary()["calls"], 0)

    def test_rate_limited_upstream_is_429(self):
        self.assertEqual(self.send(self.client(status=429, payload={})).status_code, 429)

    def test_network_failure_is_502(self):
        self.assertEqual(self.send(self.client(raises=OSError("down"))).status_code, 502)
        self.assertEqual(self.service.budget.pending_krw, 0)

    def test_rejects_wrong_type_empty_and_oversized(self):
        client = self.client()
        self.assertEqual(self.send(client, content_type="image/png").status_code, 415)
        self.assertEqual(self.send(client, content=b"").status_code, 422)
        self.assertEqual(self.send(client, content=b"x" * (2 * 1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.calls, [])

    def test_untyped_upload_uses_file_extension(self):
        response = self.send(self.client(), content_type="application/octet-stream")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Content-Type: audio/mp4", self.calls[0][1])

    def test_missing_key_is_503(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            client = self.client()
        self.assertEqual(self.send(client).status_code, 503)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
