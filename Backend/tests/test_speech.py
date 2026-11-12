import asyncio
import base64
from io import BytesIO
import json
import time
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import wave

import httpx

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from Backend.speech import OpenAISpeechService, create_speech_router, pcm_wav, RealtimeRateLimited


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
    async def test_artwork_voices_are_scoped_and_do_not_change_default_voice(self):
        calls = []
        async def realtime(service, text, model):
            calls.append(("realtime", service.voice))
            return pcm_wav(b"\x00\x00" * 240)
        async def gemini(service, text, model):
            calls.append(("gemini", service.gemini_voice))
            return pcm_wav(b"\x01\x00" * 240)
        service = OpenAISpeechService(Path(self.temp.name))
        service.gemini_key = "test-gemini"
        service.gemini_models = ["gemini-test"]
        with patch.object(OpenAISpeechService, "_generate", realtime), patch.object(OpenAISpeechService, "_gemini", gemini):
            male, _ = await service.synthesize("같은 문장입니다.", "nmk-c0002")
            female, _ = await service.synthesize("같은 문장입니다.", "aic-08")
            default, _ = await service.synthesize("같은 문장입니다.")
            self.assertEqual(calls, [("realtime", "cedar"), ("gemini", "Kore"), ("realtime", service.voice)])
            self.assertEqual(len({male, female, default}), 3)
            self.assertEqual(service.artwork_services["nmk-c0002"].gemini_voice, "Charon")
            self.assertEqual(service.artwork_services["nmk-c0002"].classic_voice, "onyx")
            self.assertIs(service.artwork_services["aic-08"].budget, service.budget)
            self.assertIs(service.artwork_services["aic-08"].slots, service.slots)
            await service.synthesize("같은 문장입니다.", "aic-08")
            self.assertEqual(len(calls), 3)
        # The selected voice still comes from persistent storage after a service restart.
        restarted = OpenAISpeechService(Path(self.temp.name))
        self.assertEqual((await restarted.synthesize("같은 문장입니다.", "aic-08"))[0], female)

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # One realtime model and one speech model unless a test sets a longer candidate list.
        self.env = patch.dict("os.environ", {"OPENAI_API_KEY": "test-openai-key", "OPENAI_TTS_MODEL": "gpt-realtime-2.1-mini", "OPENAI_TTS_VOICE": "marin",
                                             "OPENAI_TTS_REALTIME_MODELS": "-", "OPENAI_TTS_SPEECH_MODELS": "-",
                                             "GEMINI_TTS_MODELS": "-"})
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

    async def test_daily_upstream_limit_is_explained_without_private_details(self):
        service = self.service(FakeSocket())
        response = httpx.Response(429, json={"error": {
            "code": "rate_limit_exceeded", "type": "requests",
            "message": "Rate limit reached in organization PRIVATE_ORG on requests per day (RPD): Limit 50, Used 50",
        }})
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response))
        with patch("Backend.speech.httpx.AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                await service._fallback("붉은 꽃이 보여요.")
        self.assertEqual(caught.exception.status_code, 429)
        self.assertIn("오늘의", caught.exception.detail)
        self.assertIn("저장된 음성", caught.exception.detail)
        self.assertNotIn("PRIVATE_ORG", caught.exception.detail)
        self.assertEqual(service.budget.pending_krw, 0)
        self.assertEqual(service.budget.summary()["spent_krw"], 0)

    async def test_fallback_credit_error_is_not_reported_as_a_retryable_delay(self):
        service = self.service(FakeSocket())
        response = httpx.Response(429, json={"error": {"code": "credit_balance_exhausted"}})
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response))
        with patch("Backend.speech.httpx.AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                await service._fallback("붉은 꽃이 보여요.")
        self.assertIn("크레딧", caught.exception.detail)
        self.assertEqual(service.budget.pending_krw, 0)

    async def test_realtime_rate_limit_falls_back_to_speech_endpoint_and_pauses_realtime(self):
        with patch.dict("os.environ", {"OPENAI_TTS_SPEECH_MODELS": "gpt-4o-mini-tts"}):
            service = self.service(FakeSocket())
        fallback_audio = pcm_wav(b"\x00\x00" * 240)
        with patch.object(service, "_generate", side_effect=RealtimeRateLimited()) as realtime, \
                patch.object(service, "_fallback", return_value=fallback_audio) as fallback:
            _, audio = await service.synthesize("붉은 꽃이 보여요.")
            self.assertEqual(audio, fallback_audio)
            await service.synthesize("파란 하늘이 보여요.")
        self.assertEqual(realtime.call_count, 1)  # Second sentence skips Realtime while it is paused.
        self.assertEqual(fallback.call_count, 2)

    async def test_credit_or_permission_errors_stop_but_broken_results_try_the_next_model(self):
        with patch.dict("os.environ", {"OPENAI_TTS_SPEECH_MODELS": "gpt-4o-mini-tts"}):
            service = self.service(FakeSocket())
        with patch.object(service, "_generate", side_effect=HTTPException(429, "credit")), \
                patch.object(service, "_fallback") as fallback:
            with self.assertRaises(HTTPException):
                await service.synthesize("붉은 꽃이 보여요.")
        fallback.assert_not_called()
        audio = pcm_wav(b"\x00\x00" * 240)
        with patch.object(service, "_generate", side_effect=HTTPException(502, "rewritten")), \
                patch.object(service, "_fallback", return_value=audio) as fallback:
            self.assertEqual((await service.synthesize("파란 하늘이 보여요."))[1], audio)
        fallback.assert_called_once()

    async def test_each_candidate_model_is_tried_and_paused_after_its_own_limit(self):
        with patch.dict("os.environ", {"OPENAI_TTS_REALTIME_MODELS": "gpt-realtime-2.1", "OPENAI_TTS_SPEECH_MODELS": "tts-1-hd,tts-1"}):
            service = self.service(FakeSocket())
        self.assertEqual(service.realtime_models, ["gpt-realtime-2.1-mini", "gpt-realtime-2.1"])
        audio = pcm_wav(b"\x00\x00" * 240)
        def speech(text, model):
            if model == "tts-1-hd":
                raise RealtimeRateLimited()
            return audio
        with patch.object(service, "_generate", side_effect=RealtimeRateLimited()) as realtime, \
                patch.object(service, "_fallback", side_effect=speech) as fallback:
            self.assertEqual((await service.synthesize("붉은 꽃이 보여요."))[1], audio)
            self.assertEqual([c.args[1] for c in realtime.call_args_list], ["gpt-realtime-2.1-mini", "gpt-realtime-2.1"])
            self.assertEqual([c.args[1] for c in fallback.call_args_list], ["tts-1-hd", "tts-1"])
            await service.synthesize("파란 하늘이 보여요.")
        # Limited models are skipped while paused: the second sentence goes straight to tts-1.
        self.assertEqual(realtime.call_count, 2)
        self.assertEqual([c.args[1] for c in fallback.call_args_list], ["tts-1-hd", "tts-1", "tts-1"])

    async def test_when_every_model_is_resting_they_are_tried_again(self):
        with patch.dict("os.environ", {"OPENAI_TTS_SPEECH_MODELS": "tts-1"}):
            service = self.service(FakeSocket())
        audio = pcm_wav(b"\x00\x00" * 240)
        service.blocked_until = {"gpt-realtime-2.1-mini": time.monotonic() + 999, "tts-1": time.monotonic() + 999}
        with patch.object(service, "_generate", side_effect=RealtimeRateLimited(daily=True)), \
                patch.object(service, "_fallback", return_value=audio) as fallback:
            self.assertEqual((await service.synthesize("붉은 꽃이 보여요."))[1], audio)  # not an instant 429
        fallback.assert_called_once()

    async def test_gemini_voice_returns_wav_from_raw_or_wav_audio_and_skips_on_refusal(self):
        service = self.service(FakeSocket())
        service.gemini_key = "test-gemini-key"
        pcm = b"\x01\x00" * 240
        wav_bytes = pcm_wav(pcm)
        for mime, data in (("audio/L16;codec=pcm;rate=24000", pcm), ("audio/wav", wav_bytes)):
            payload = {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}]}}]}
            client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request, p=payload: httpx.Response(200, json=p)))
            with patch("Backend.speech.httpx.AsyncClient", return_value=client):
                audio = await service._gemini("붉은 꽃이 보여요.", "gemini-3.8-flash-tts")
            with wave.open(BytesIO(audio)) as wav:
                self.assertEqual(wav.readframes(wav.getnframes()), pcm)
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(402, json={"error": {"message": "credits depleted"}})))
        with patch("Backend.speech.httpx.AsyncClient", return_value=client):
            with self.assertRaises(RealtimeRateLimited) as caught:
                await service._gemini("붉은 꽃이 보여요.", "gemini-3.8-flash-tts")
        self.assertTrue(caught.exception.daily)  # a refusal only skips this candidate

    async def test_classic_tts_models_use_a_supported_voice_without_instructions(self):
        service = self.service(FakeSocket())
        seen = {}
        def respond(request):
            seen.update(json.loads(request.content))
            return httpx.Response(200, content=b"\x00\x00" * 240)
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch("Backend.speech.httpx.AsyncClient", return_value=client):
            await service._fallback("붉은 꽃이 보여요.", "tts-1-hd")
        self.assertEqual((seen["model"], seen["voice"]), ("tts-1-hd", "nova"))
        self.assertNotIn("instructions", seen)

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
