import asyncio
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.body_limit import RequestBodyLimitMiddleware

from Backend.main import create_app
from Backend.run_demo import backup_databases


class DemoSafetyTests(unittest.TestCase):
    def test_readiness_checks_both_databases_and_recovers(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            with TestClient(create_app(root)) as client:
                self.assertEqual(client.get("/ready").json(), {"status": "ready", "artworks": 0})
                original = root / "users.sqlite3"
                moved = root / "users.bak"
                original.rename(moved)
                self.assertEqual(client.get("/ready").status_code, 503)
                self.assertFalse(original.exists())  # 상태 확인이 빈 DB를 만들지 않는다.
                self.assertEqual(client.get("/health").status_code, 200)
                moved.rename(original)
                self.assertEqual(client.get("/ready").status_code, 200)

    def test_app_rejects_oversized_declared_request_before_validation(self):
        with TemporaryDirectory() as folder, TestClient(create_app(Path(folder))) as client:
            response = client.post("/upload", content=b"x", headers={"Content-Length": str(13 * 1024 * 1024)})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(client.get("/health").status_code, 200)

    def test_streaming_body_without_content_length_is_bounded(self):
        app = FastAPI()
        app.add_middleware(RequestBodyLimitMiddleware, max_body_size=10)

        @app.post("/read")
        async def read(request: Request):
            await request.body()
            return {"ok": True}

        async def exercise():
            messages = iter([{"type": "http.request", "body": b"123456", "more_body": True},
                             {"type": "http.request", "body": b"789012", "more_body": False}])
            output = []

            async def receive():
                return next(messages)

            async def send(message):
                output.append(message)

            await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                       "method": "POST", "path": "/read", "root_path": "", "scheme": "http",
                       "query_string": b"", "headers": [], "server": ("test", 80),
                       "client": ("test", 1)}, receive, send)
            self.assertEqual(output[0]["status"], 413)

        asyncio.run(exercise())

    def test_backup_contains_committed_rows_even_with_wal_open(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            with sqlite3.connect(root / "users.sqlite3") as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("CREATE TABLE example (value TEXT)")
                db.execute("INSERT INTO example VALUES ('saved')")
                db.commit()
                backup = backup_databases(root)
                with sqlite3.connect(backup / "users.sqlite3") as copy:
                    self.assertEqual(copy.execute("SELECT value FROM example").fetchone(), ("saved",))
                self.assertEqual((backup / "users.sqlite3").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
