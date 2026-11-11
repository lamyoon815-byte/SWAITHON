"""보기 설정 테스트(화면 맞추기)의 음성 답변 기록을 서버 DB에 저장한다.

음성을 글자로 바꾸는 일은 /transcribe(ai/transcription.py), 글자를 보기와 맞추는 일은 앱(spoken-answer.ts)이 한다.
이 모듈은 그 결과(인식된 글자, 고른 보기, 정답 여부)를 data/voice-answers.sqlite3에 저장·조회·삭제한다.
음성 원본은 저장하지 않는다.
"""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
from threading import Lock
import time
import uuid

COLUMNS = ("id", "session_id", "step", "item", "choices", "transcript", "choice", "expected", "is_correct", "created_at")


class VoiceAnswerStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()
        # 연결은 매번 닫는다(윈도우에서 열린 sqlite 파일이 잠겨 지워지지 않는 문제 방지).
        with closing(self._connect()) as connection, connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS voice_answers (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    step TEXT NOT NULL,
                    item TEXT,
                    choices TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    choice TEXT,
                    expected TEXT,
                    is_correct INTEGER,
                    created_at REAL NOT NULL
                )""")
            connection.execute("CREATE INDEX IF NOT EXISTS voice_answers_session ON voice_answers(session_id, created_at)")

    def _connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def add(self, *, session_id, step, item, choices, transcript, choice, expected):
        is_correct = None if expected is None or choice is None else choice == expected
        record = {"id": uuid.uuid4().hex, "session_id": session_id, "step": step, "item": item, "choices": choices,
                  "transcript": transcript, "choice": choice, "expected": expected, "is_correct": is_correct,
                  "created_at": time.time()}
        with self.lock, closing(self._connect()) as connection, connection:
            connection.execute(
                "INSERT INTO voice_answers (id, session_id, step, item, choices, transcript, choice, expected, is_correct, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (record["id"], session_id, step, item, json.dumps(choices, ensure_ascii=False), transcript, choice,
                 expected, None if is_correct is None else int(is_correct), record["created_at"]))
        return record

    def session(self, session_id, limit=200):
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"SELECT {', '.join(COLUMNS)} FROM voice_answers WHERE session_id = ? ORDER BY created_at LIMIT ?",
                (session_id, limit)).fetchall()
        records = [dict(zip(COLUMNS, row)) for row in rows]
        for record in records:
            record["choices"] = json.loads(record["choices"])
            record["is_correct"] = None if record["is_correct"] is None else bool(record["is_correct"])
        return records

    def delete_session(self, session_id):
        with self.lock, closing(self._connect()) as connection, connection:
            return connection.execute("DELETE FROM voice_answers WHERE session_id = ?", (session_id,)).rowcount
