from contextlib import closing
from hashlib import sha256
import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from Backend.accounts import RateLimiter
from Backend.main import create_app


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = create_app(self.root / "data")
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def register(self, email="first@example.com"):
        response = self.client.post("/auth/register", json={"email": email, "password": "example-password-123", "nickname": "관람객"})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        return data, {"Authorization": "Bearer " + data["access_token"]}

    def test_update_nickname(self):
        _, headers = self.register()
        response = self.client.patch("/me", json={"nickname": "  새 이름  "}, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["nickname"], "새 이름")
        self.assertEqual(self.client.get("/me", headers=headers).json()["nickname"], "새 이름")
        self.assertEqual(self.client.patch("/me", json={"nickname": "   "}, headers=headers).status_code, 422)
        self.assertEqual(self.client.patch("/me", json={"nickname": "가" * 41}, headers=headers).status_code, 422)
        self.assertEqual(self.client.patch("/me", json={"nickname": "x", "email": "a@b.c"}, headers=headers).status_code, 422)
        self.assertEqual(self.client.patch("/me", json={"nickname": "x"}).status_code, 401)

    def test_register_login_logout_and_password_storage(self):
        data, headers = self.register()
        self.assertEqual(data["token_type"], "bearer")
        self.assertEqual(self.client.get("/me", headers=headers).json()["email"], "first@example.com")
        with closing(self.app.state.accounts.connect()) as connection, connection:
            hashed = connection.execute("SELECT password_hash FROM users").fetchone()[0]
            token = connection.execute("SELECT token_hash FROM sessions").fetchone()[0]
        self.assertTrue(hashed.startswith("$argon2"))
        self.assertNotIn("example-password-123", hashed)
        self.assertEqual(token, sha256(data["access_token"].encode()).hexdigest())
        login = self.client.post("/auth/login", json={"email": "FIRST@example.com", "password": "example-password-123"})
        self.assertEqual(login.status_code, 200)
        self.assertNotEqual(login.json()["access_token"], data["access_token"])
        self.assertEqual(self.client.post("/auth/logout", headers=headers).status_code, 204)
        self.assertEqual(self.client.get("/me", headers=headers).status_code, 401)

    def test_duplicate_invalid_and_unknown_credentials(self):
        self.register()
        duplicate = self.client.post("/auth/register", json={"email": "FIRST@example.com", "password": "other-password-1", "nickname": "중복"})
        self.assertEqual(duplicate.status_code, 409)
        messages = []
        for email in ["first@example.com", "unknown@example.com"]:
            response = self.client.post("/auth/login", json={"email": email, "password": "incorrect-password"})
            self.assertEqual(response.status_code, 401)
            messages.append(response.json())
        self.assertEqual(messages[0], messages[1])
        self.assertEqual(self.client.post("/auth/register", json={"email": "bad", "password": "short", "nickname": ""}).status_code, 422)
        for weak in ("onlyletters", "1234567890"):
            response = self.client.post("/auth/register", json={"email": "weak@example.com", "password": weak, "nickname": "관람객"})
            self.assertEqual(response.status_code, 422)

    def test_expired_or_missing_session(self):
        _, headers = self.register()
        with closing(self.app.state.accounts.connect()) as connection, connection:
            connection.execute("UPDATE sessions SET expires_at = 0")
        for route in ["/me", "/me/profile", "/me/history"]:
            self.assertEqual(self.client.get(route).status_code, 401)
            self.assertEqual(self.client.get(route, headers=headers).status_code, 401)
        self.assertEqual(self.client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code, 401)

    def test_profile_persists_and_is_isolated(self):
        first, headers = self.register()
        _, other_headers = self.register("second@example.com")
        profile = self.client.get("/me/profile", headers=headers).json()
        profile.update({"contrast": 1.6, "brightness": 0.2, "color_vision": "deuteranopia", "zoom": 3})
        self.assertEqual(self.client.put("/me/profile", headers=headers, json=profile).status_code, 200)
        self.assertEqual(self.app.state.accounts.profile(first["user"]["id"]).contrast, 1.6)
        self.assertEqual(self.client.get("/me/profile", headers=other_headers).json()["contrast"], 1)
        self.assertEqual(self.client.put("/me/profile", headers=headers, json={"contrast": 10}).status_code, 422)
        self.assertEqual(self.client.put("/me/profile", headers=headers, json={"unknown": 1}).status_code, 422)

    def test_ai_profile_isolated_persisted_and_independent(self):
        first, headers = self.register()
        _, other = self.register("second@example.com")
        self.assertEqual(self.client.get("/me/ai-profile").status_code, 401)
        self.assertIsNone(self.client.get("/me/ai-profile", headers=headers).json())
        response = self.client.put("/me/ai-profile", headers=headers, json={"color_type": "deutan", "brightness": 25, "edge": 0.5})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.app.state.accounts.ai_profile(first["user"]["id"]).brightness, 25)
        self.assertIsNone(self.client.get("/me/ai-profile", headers=other).json())
        self.assertEqual(self.client.get("/me/profile", headers=headers).json()["brightness"], 0)
        for data in [{"brightness": 51}, {"severity": -1}, {"edge": 2}, {"color_type": "deuteranopia"}, {"unknown": 1}]:
            self.assertEqual(self.client.put("/me/ai-profile", headers=headers, json=data).status_code, 422)

    def test_existing_history_database_migrates_without_losing_records(self):
        data, headers = self.register()
        with closing(self.app.state.accounts.connect()) as connection, connection:
            connection.execute("DROP TABLE ai_profiles")
            connection.execute("ALTER TABLE history DROP COLUMN ai_profile_json")
            connection.execute("INSERT INTO history VALUES (?, ?, ?, ?, ?)",
                               ("old-entry", data["user"]["id"], "old-artwork", "{}", "2026-11-01T00:00:00+00:00"))
        self.app.state.accounts.initialize()
        self.app.state.accounts.initialize()
        with closing(self.app.state.accounts.connect()) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(history)")}
        self.assertIn("ai_profile_json", columns)
        history = self.client.get("/me/history", headers=headers).json()
        self.assertEqual(history["items"][0]["id"], "old-entry")
        self.assertIsNone(history["items"][0]["ai_profile"])

    def test_calibration_and_viewing_settings_save_together_and_survive_restart(self):
        first, headers = self.register()
        _, other = self.register("other@example.com")
        settings = {"color_type": "deutan", "severity": 0.4, "edge": 0.2}
        payload = {"calibration": settings, "contrast": 1.2, "brightness": -0.25, "sharpen": 0.3}
        response = self.client.put("/me/profile", headers=headers, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["calibration"], settings)
        self.assertEqual(response.json()["color_vision"], "deuteranopia")
        ai = self.client.get("/me/ai-profile", headers=headers).json()
        self.assertEqual(ai, {**settings, "contrast": 1.2, "brightness": -12.5, "sharpness": 0.3})
        self.assertIsNone(self.client.get("/me/profile", headers=other).json()["calibration"])
        # Read through a new store/connection, not the request's in-memory input object.
        from Backend.accounts import AccountStore
        restored = AccountStore(self.root / "data").profile(first["user"]["id"])
        self.assertEqual(restored.calibration.model_dump(), settings)
        self.assertEqual(restored.contrast, 1.2)

    def test_failed_ai_profile_write_rolls_back_app_settings_too(self):
        _, headers = self.register()
        before = self.client.get("/me/profile", headers=headers).json()
        with closing(self.app.state.accounts.connect()) as connection, connection:
            connection.execute("""CREATE TRIGGER fail_calibration BEFORE INSERT ON ai_profiles
                                  BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.put("/me/profile", headers=headers, json={
                "contrast": 1.8, "calibration": {"color_type": "protan", "severity": 0.4, "edge": 0.2},
            })
        self.assertEqual(self.client.get("/me/profile", headers=headers).json(), before)
        self.assertIsNone(self.client.get("/me/ai-profile", headers=headers).json())

    def test_color_levels_persist_independently_through_old_and_new_profile_writes(self):
        first, headers = self.register()
        settings = {"color_type": "protan", "severity": 0.4, "edge": 0.2,
                    "color_severities": {"protan": 0.4, "deutan": 0.6, "tritan": 0.8}}
        saved = self.client.put("/me/profile", headers=headers, json={"calibration": settings}).json()
        self.assertEqual(saved["calibration"], settings)
        changed = self.client.put("/me/profile", headers=headers, json={**saved,
            "calibration": {"color_type": "deutan", "severity": 0.2, "edge": 0.2}})
        self.assertEqual(changed.status_code, 200, changed.text)
        levels = {"protan": 0.4, "deutan": 0.2, "tritan": 0.8}
        self.assertEqual(changed.json()["calibration"]["color_severities"], levels)
        self.assertNotEqual(changed.json()["revision"], saved["revision"])
        # A zero disables only that type; the direct AI-profile endpoint also preserves others.
        changed = self.client.put("/me/ai-profile", headers=headers, json={"color_type": "tritan", "severity": 0})
        self.assertEqual(changed.status_code, 200, changed.text)
        levels["tritan"] = 0
        from Backend.accounts import AccountStore
        restored = AccountStore(self.root / "data").profile(first["user"]["id"])
        self.assertEqual(restored.calibration.color_severities, levels)
        # The existing off choice disables rendering without erasing the individual values.
        off = self.client.put("/me/profile", headers=headers, json={"calibration": {"color_type": "normal", "severity": 0, "edge": 0}})
        self.assertEqual(off.json()["calibration"]["color_severities"], levels)
        for invalid in ({"protan": -0.1}, {"tritan": 1.1}, {"normal": 0}, {"other": 0.2}):
            response = self.client.put("/me/profile", headers=headers, json={"calibration": {**settings, "color_severities": invalid}})
            self.assertEqual(response.status_code, 422, response.text)

    def test_profile_revision_prevents_stale_settings_from_overwriting_calibration(self):
        _, headers = self.register()
        first = self.client.put("/me/profile", headers=headers, json={
            "calibration": {"color_type": "deutan", "severity": 0.2, "edge": 0.2}, "contrast": 1.2,
        }).json()
        newer = {**first, "calibration": {"color_type": "deutan", "severity": 0.8, "edge": 0.4}}
        response = self.client.put("/me/profile", headers=headers, json=newer)
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        self.assertNotEqual(saved["revision"], first["revision"])
        conflict = self.client.put("/me/profile", headers=headers, json={**first, "narration_mode": "facts"})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.client.get("/me/profile", headers=headers).json(), saved)
        # Legacy clients omitting calibration still receive the real retained DB settings.
        response = self.client.put("/me/profile", headers=headers, json={"narration_mode": "facts"})
        self.assertEqual(response.json(), self.client.get("/me/profile", headers=headers).json())
        self.assertEqual(response.json()["calibration"]["severity"], 0.8)

    def test_history_ownership_and_profile_snapshot(self):
        _, headers = self.register()
        _, other_headers = self.register("second@example.com")
        with Image.new("RGB", (2, 2)) as image:
            image.save(self.root / "sample.png")
        manifest = self.root / "catalog.json"
        manifest.write_text(json.dumps([{"id": "sample", "title": "작품", "artist": "작가", "image_path": "sample.png"}]))
        self.app.state.catalog.import_manifest(manifest)
        self.client.put("/me/profile", headers=headers, json={"contrast": 1.5})
        self.client.put("/me/ai-profile", headers=headers, json={"edge": 0.7})
        created = self.client.post("/me/history", headers=headers, json={"artwork_id": "sample"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["profile"]["contrast"], 1.5)
        self.assertEqual(created.json()["ai_profile"]["edge"], 0.7)
        self.client.put("/me/ai-profile", headers=headers, json={"edge": 0})
        self.client.put("/me/profile", headers=headers, json={"contrast": 1})
        listing = self.client.get("/me/history", headers=headers).json()
        self.assertEqual(listing["items"][0]["profile"]["contrast"], 1.5)
        self.assertEqual(listing["items"][0]["ai_profile"]["edge"], 0.7)
        self.assertEqual(self.client.get("/me/history", headers=other_headers).json()["total"], 0)
        path = "/me/history/" + created.json()["id"]
        self.assertEqual(self.client.delete(path, headers=other_headers).status_code, 404)
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 204)
        self.assertEqual(self.client.get("/me/history", headers=headers).json()["total"], 0)
        self.assertEqual(self.client.post("/me/history", headers=headers, json={"artwork_id": "missing"}).status_code, 404)

    def test_private_cache_and_openapi_authorize(self):
        _, headers = self.register()
        self.assertEqual(self.client.get("/me/profile", headers=headers).headers["cache-control"], "no-store")
        schema = self.app.openapi()
        self.assertIn("HTTPBearer", schema["components"]["securitySchemes"])
        self.assertTrue(schema["paths"]["/me/profile"]["get"]["security"])

    def test_auth_api_rate_limit(self):
        for _ in range(10):
            self.client.post("/auth/login", json={"email": "unknown@example.com", "password": "incorrect-password"})
        response = self.client.post("/auth/login", json={"email": "unknown@example.com", "password": "incorrect-password"})
        self.assertEqual(response.status_code, 429)


class RateLimitTests(unittest.TestCase):
    def test_window_resets(self):
        limiter = RateLimiter(attempts=1, window=60)
        with patch("Backend.accounts.time.monotonic", return_value=100):
            limiter.check("user")
            with self.assertRaises(HTTPException):
                limiter.check("user")
        with patch("Backend.accounts.time.monotonic", return_value=161):
            limiter.check("user")
