import asyncio
import base64
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import wave

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from Backend.speech import OpenAISpeechService, create_speech_router


class FakeSocket:
    def __init__(self, transcript="붉은 꽃이 보여요.", status="completed", gate=None, audio=True):
        self.sent = []
        self.gate = gate
        self.events = [{"type": "session.created"}, {"type": "session.updated"}]
        if audio:
            self.events.append({"type": "response.output_audio.delta", "delta": base64.b64encode(b"\x00\x00" * 240).decode()})
        self.events.extend([
            {"type": "response.output_audio_transcript.done", "transcript": transcript},
            {"type": "response.done", "response": {"status": status, "usage": {"input_tokens": 120, "output_tokens": 100}}},
        ])

    async def send(self, message): self.sent.append(json.loads(message))
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def __aiter__(self): return self
    async def __anext__(self):
        if self.gate: await self.gate.wait()
        if not self.events: raise StopAsyncIteration
        return json.dumps(self.events.pop(0))


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict("os.environ", {"OPENAI_API_KEY": "test-openai-key", "OPENAI_TTS_MODEL": "gpt-realtime-2.1-mini", "OPENAI_TTS_VOICE": "marin"})
        self.env.start(); self.addCleanup(self.env.stop)

    def service(self, socket):
        self.connections = []
        def connect(url, **options):
            self.connections.append((url, options))
            return socket
        return OpenAISpeechService(Path(self.temp.name), connect)

    async def test_pcm_becomes_wav_and_repeat_is_cached(self):
        socket = FakeSocket()
        service = self.service(socket)
        key, audio = await service.synthesize("붉은 꽃이 보여요.")
        self.assertEqual(len(key), 64)
        with wave.open(BytesIO(audio)) as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 24000))
            self.assertEqual(wav.getnframes(), 240)
        self.assertEqual(await service.synthesize("붉은 꽃이 보여요."), (key, audio))
        self.assertEqual(len(self.connections), 1)
        self.assertEqual(socket.sent[0]["session"]["audio"]["output"]["voice"], "marin")
        self.assertEqual(socket.sent[1]["response"]["input"][0]["content"][0]["text"], "붉은 꽃이 보여요.")
        self.assertEqual(service.budget.summary()["calls"], 1)
        self.assertEqual(service.budget.pending_krw, 0)

    async def test_saved_audio_survives_restart_without_api_key_or_budget(self):
        service = self.service(FakeSocket())
        expected = await service.synthesize("붉은 꽃이 보여요.")
        def forbidden(*args, **kwargs):
            raise AssertionError("cached audio must not open an upstream connection")
        restarted = OpenAISpeechService(Path(self.temp.name), forbidden)
        restarted.key = ""
        with patch.object(restarted.budget, "reserve", side_effect=AssertionError("must not charge")):
            self.assertEqual(await restarted.synthesize("붉은 꽃이 보여요."), expected)

    async def test_voice_change_generates_a_separate_saved_audio(self):
        service = self.service(FakeSocket())
        first_key, _ = await service.synthesize("붉은 꽃이 보여요.")
        other = self.service(FakeSocket())
        other.voice = "cedar"
        second_key, _ = await other.synthesize("붉은 꽃이 보여요.")
        self.assertNotEqual(first_key, second_key)
        self.assertEqual(len(self.connections), 1)

    async def test_failed_audio_is_not_persisted(self):
        service = self.service(FakeSocket(status="incomplete"))
        with self.assertRaises(HTTPException):
            await service.synthesize("붉은 꽃이 보여요.")
        restarted = self.service(FakeSocket())
        self.assertTrue((await restarted.synthesize("붉은 꽃이 보여요."))[1].startswith(b"RIFF"))
        self.assertEqual(len(self.connections), 1)

    async def test_cancelled_listener_does_not_cancel_shared_generation(self):
        gate = asyncio.Event()
        service = self.service(FakeSocket(gate=gate))
        first = asyncio.create_task(service.synthesize("붉은 꽃이 보여요."))
        second = asyncio.create_task(service.synthesize("붉은 꽃이 보여요."))
        await asyncio.sleep(0)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError): await first
        gate.set()
        self.assertTrue((await second)[1].startswith(b"RIFF"))
        self.assertEqual(len(self.connections), 1)
        self.assertEqual(service.pending, {})

    async def test_rewritten_text_and_incomplete_or_empty_audio_are_rejected(self):
        for options in [{"transcript": "이것은 다른 내용입니다."}, {"status": "incomplete"}, {"audio": False}]:
            with self.subTest(options=options):
                service = self.service(FakeSocket(**options))
                with self.assertRaises(HTTPException) as error:
                    await service.synthesize("붉은 꽃이 보여요.")
                self.assertEqual(error.exception.status_code, 502)
                self.assertEqual(service.cache, {})
                self.assertEqual(service.budget.pending_krw, 0)

    async def test_no_key_does_not_connect_or_reserve_budget(self):
        service = self.service(FakeSocket())
        service.key = ""
        with self.assertRaises(HTTPException) as error:
            await service.synthesize("붉은 꽃이 보여요.")
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.connections, [])
        self.assertEqual(service.budget.summary()["calls"], 0)

    async def test_exhausted_credits_reports_actionable_error_without_charging(self):
        socket = FakeSocket()
        socket.events = [{"type": "error", "error": {"type": "insufficient_quota", "code": "credit_balance_exhausted"}}]
        service = self.service(socket)
        with self.assertRaises(HTTPException) as error:
            await service.synthesize("붉은 꽃이 보여요.")
        self.assertEqual(error.exception.status_code, 429)
        self.assertIn("크레딧", error.exception.detail)
        self.assertEqual(service.budget.pending_krw, 0)
        self.assertEqual(service.budget.summary()["spent_krw"], 0)

    async def test_connection_failure_releases_reservation(self):
        def broken(*args, **kwargs): raise OSError("secret upstream connection details")
        service = OpenAISpeechService(Path(self.temp.name), broken)
        with self.assertRaises(HTTPException) as error:
            await service.synthesize("붉은 꽃이 보여요.")
        self.assertEqual(error.exception.status_code, 502)
        self.assertNotIn("secret", error.exception.detail)
        self.assertEqual(service.budget.pending_krw, 0)
        self.assertEqual(service.budget.summary()["spent_krw"], 0)


class SpeechRouteTests(unittest.TestCase):
    def test_wav_contract_and_input_validation(self):
        with TemporaryDirectory() as temp, patch.dict("os.environ", {"OPENAI_API_KEY": "test"}):
            service = OpenAISpeechService(Path(temp), lambda *args, **kwargs: FakeSocket())
            app = FastAPI()
            app.include_router(create_speech_router(service))
            with TestClient(app) as client:
                for text in ["", " " * 5, "가" * 601]:
                    self.assertEqual(client.post("/speech", json={"text": text}).status_code, 422)
                response = client.post("/speech", json={"text": "붉은 꽃이 보여요."})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["content-type"], "audio/wav")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(len(response.headers["x-voice-cache-key"]), 64)
                self.assertNotIn(b"test-openai-key", response.content)
