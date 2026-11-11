"""Persistent generated narration and WAV cache, separate from reviewed catalog data."""
from contextlib import closing
from pathlib import Path
import sqlite3


class GeneratedCache:
    def __init__(self, data_dir: Path):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "generated-media.sqlite3"
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS generated_media (
                namespace TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                payload BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (namespace, cache_key)
            )""")

    def get(self, namespace: str, key: str) -> bytes | None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            row = connection.execute(
                "SELECT payload FROM generated_media WHERE namespace = ? AND cache_key = ?",
                (namespace, key),
            ).fetchone()
        return bytes(row[0]) if row else None

    def put(self, namespace: str, key: str, payload: bytes):
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "INSERT OR IGNORE INTO generated_media (namespace, cache_key, payload) VALUES (?, ?, ?)",
                (namespace, key, payload),
            )
