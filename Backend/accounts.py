"""계정·만료 가능한 Bearer 세션·시각 프로필·개인 관람 기록."""

from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import secrets
import sqlite3
from threading import Lock
import time
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator, model_validator
from pwdlib import PasswordHash

if __package__:
    from .ai.profile import AIProfile, ColorSeverities
else:
    from ai.profile import AIProfile, ColorSeverities


class Credentials(BaseModel):
    email: EmailStr
    password: SecretStr = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).lower()


class Registration(Credentials):
    nickname: str = Field(min_length=1, max_length=40)
    model_config = ConfigDict(str_strip_whitespace=True)

    # New passwords need letters and digits. Login keeps the length-only rule for existing accounts.
    @field_validator("password")
    @classmethod
    def letters_and_digits(cls, value):
        secret = value.get_secret_value()
        if not (any(c.isascii() and c.isalpha() for c in secret) and any(c.isdigit() for c in secret)):
            raise ValueError("비밀번호는 영문과 숫자를 모두 포함해야 합니다")
        return value


class NicknameUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    nickname: str = Field(min_length=1, max_length=40)


class User(BaseModel):
    id: str
    email: str
    nickname: str
    created_at: str


class LoginResult(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: User


class CalibrationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    color_type: Literal["normal", "protan", "deutan", "tritan"]
    severity: float = Field(ge=0, le=1)
    color_severities: ColorSeverities | None = Field(default=None, exclude_if=lambda value: value is None)
    edge: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def normal_has_no_color_correction(self):
        if self.color_type == "normal" and self.severity != 0:
            raise ValueError("색 보정 없음의 severity는 0이어야 합니다")
        return self


COLOR_VISION = {"normal": "normal", "protan": "protanopia", "deutan": "deuteranopia", "tritan": "tritanopia"}


class VisualProfile(BaseModel):
    """진단값이 아닌 사용자 설정. FE 슬라이더와 같은 단위로 저장한다."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    color_vision: Literal["normal", "protanopia", "deuteranopia", "tritanopia"] = "normal"
    color_severity: float = Field(default=0, ge=0, le=1)
    strength: float = Field(default=1, ge=0, le=1)
    contrast: float = Field(default=1, ge=0.5, le=2)
    brightness: float = Field(default=0, ge=-1, le=1)
    sharpen: float = Field(default=0, ge=0, le=2)
    zoom: float = Field(default=1, ge=1, le=8)
    narration_mode: Literal["facts", "interpretations", "both"] = "both"
    # 감상 피드백으로 바뀔 수 있는 해설 선호. brief=약 1분, detailed=약 3분.
    narration_length: Literal["brief", "detailed"] = "brief"
    # AI 간결 해설에서 무엇을 더 자세히 말할지. balanced는 기존 해설과 같다.
    narration_focus: Literal["balanced", "color", "position", "story"] = "balanced"
    speech_rate: float = Field(default=1, ge=0.75, le=1.5)
    high_contrast: bool = False
    # 앱 설정과 함께 원자적으로 저장하며, 조회 시 ai_profiles에서 읽는다.
    calibration: CalibrationSettings | None = None
    revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class HistoryInput(BaseModel):
    artwork_id: str = Field(min_length=1, max_length=80)
    profile: VisualProfile | None = None


class HistoryEntry(BaseModel):
    id: str
    artwork_id: str
    profile: VisualProfile
    ai_profile: AIProfile | None = None
    viewed_at: str


class HistoryList(BaseModel):
    items: list[HistoryEntry]
    total: int
    limit: int
    offset: int


class AccountStore:
    SESSION_SECONDS = 7 * 24 * 60 * 60

    def __init__(self, data_dir: Path):
        self.path = data_dir / "users.sqlite3"
        self.password_hash = PasswordHash.recommended()
        self.dummy_hash = self.password_hash.hash(secrets.token_urlsafe(24))

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                    nickname TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE TABLE IF NOT EXISTS profiles (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    profile_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    artwork_id TEXT NOT NULL, profile_json TEXT NOT NULL, viewed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ai_profiles (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    profile_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS history_user_time ON history(user_id, viewed_at DESC);
                CREATE TABLE IF NOT EXISTS feedback (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    artwork_id TEXT NOT NULL, satisfaction TEXT NOT NULL, comment TEXT,
                    intent_json TEXT, profile_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    applied_json TEXT, applied_at TEXT
                );
                CREATE INDEX IF NOT EXISTS feedback_user_time ON feedback(user_id, created_at DESC);
            """)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(history)")}
            if "ai_profile_json" not in columns:
                connection.execute("ALTER TABLE history ADD COLUMN ai_profile_json TEXT")

    def ai_profile(self, user_id: str):
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT profile_json FROM ai_profiles WHERE user_id = ?", (user_id,)).fetchone()
        return AIProfile.model_validate_json(row[0]) if row else None

    def set_ai_profile(self, user_id: str, profile: AIProfile):
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute("SELECT profile_json FROM ai_profiles WHERE user_id = ?", (user_id,)).fetchone()
                profile = profile.with_color_severities(AIProfile.model_validate_json(row[0]) if row else None)
                connection.execute(
                    "INSERT INTO ai_profiles VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json",
                    (user_id, profile.model_dump_json()),
                )
        return profile

    @staticmethod
    def public_user(row):
        return {key: row[key] for key in ("id", "email", "nickname", "created_at")}

    def _session(self, connection, user):
        token = secrets.token_urlsafe(32)
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
        connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            (sha256(token.encode()).hexdigest(), user["id"], time.time() + self.SESSION_SECONDS),
        )
        return {"access_token": token, "expires_in": self.SESSION_SECONDS, "user": user}

    def register(self, data: Registration):
        user = {"id": str(uuid4()), "email": str(data.email), "nickname": data.nickname,
                "created_at": datetime.now(timezone.utc).isoformat()}
        hashed = self.password_hash.hash(data.password.get_secret_value())
        try:
            with closing(self.connect()) as connection:
                with connection:
                    connection.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?)",
                        (user["id"], user["email"], user["nickname"], hashed, user["created_at"]))
                    connection.execute("INSERT INTO profiles VALUES (?, ?)",
                        (user["id"], VisualProfile().model_dump_json()))
                    return self._session(connection, user)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "이미 가입된 이메일입니다.") from exc

    def login(self, data: Credentials):
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (str(data.email),)).fetchone()
            valid = self.password_hash.verify(data.password.get_secret_value(), row["password_hash"] if row else self.dummy_hash)
            if not row or not valid:
                raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
            with connection:
                return self._session(connection, self.public_user(row))

    def authenticate(self, token: str):
        with closing(self.connect()) as connection:
            row = connection.execute(
                """SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
                   WHERE token_hash = ? AND expires_at > ?""",
                (sha256(token.encode()).hexdigest(), time.time()),
            ).fetchone()
        if row is None:
            raise HTTPException(401, "로그인이 필요하거나 세션이 만료되었습니다.", headers={"WWW-Authenticate": "Bearer"})
        return self.public_user(row)

    def set_nickname(self, user_id: str, nickname: str):
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname, user_id))
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return self.public_user(row)

    def logout(self, token: str):
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (sha256(token.encode()).hexdigest(),))

    def profile(self, user_id: str):
        with closing(self.connect()) as connection:
            return self._profile_snapshot(connection, user_id)[0]

    def correction_profile(self, user_id: str):
        with closing(self.connect()) as connection:
            return self._profile_snapshot(connection, user_id)

    @staticmethod
    def _profile_snapshot(connection, user_id: str):
        row = connection.execute(
            """SELECT profiles.profile_json, ai_profiles.profile_json AS ai_profile_json
               FROM profiles LEFT JOIN ai_profiles ON profiles.user_id = ai_profiles.user_id
               WHERE profiles.user_id = ?""", (user_id,),
        ).fetchone()
        profile = VisualProfile.model_validate_json(row["profile_json"])
        ai = None
        if row["ai_profile_json"]:
            ai = AIProfile.model_validate_json(row["ai_profile_json"])
            profile.calibration = CalibrationSettings(
                color_type=ai.color_type, severity=ai.severity if ai.color_type != "normal" else 0, edge=ai.edge,
                color_severities=ai.color_severities,
            )
            profile.color_vision = COLOR_VISION[ai.color_type]
            profile.color_severity = profile.calibration.severity
        profile.revision = sha256(profile.model_dump_json(exclude={"revision"}).encode()).hexdigest()
        return profile, ai

    def set_profile(self, user_id: str, profile: VisualProfile):
        ai_profile = None
        if profile.calibration is not None:
            settings = profile.calibration
            profile = profile.model_copy(update={
                "color_vision": COLOR_VISION[settings.color_type], "color_severity": settings.severity,
            })
            ai_profile = AIProfile(**settings.model_dump(), contrast=profile.contrast,
                                   brightness=profile.brightness * 50, sharpness=profile.sharpen)
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                current, previous_ai = self._profile_snapshot(connection, user_id)
                if profile.revision is not None and profile.revision != current.revision:
                    raise HTTPException(409, "다른 화면에서 보정값이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.")
                if ai_profile is not None:
                    ai_profile = ai_profile.with_color_severities(previous_ai)
                connection.execute("UPDATE profiles SET profile_json = ? WHERE user_id = ?",
                                   (profile.model_dump_json(exclude={"calibration", "revision"}), user_id))
                if ai_profile is not None:
                    connection.execute(
                        "INSERT INTO ai_profiles VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json",
                        (user_id, ai_profile.model_dump_json()),
                    )
                saved = self._profile_snapshot(connection, user_id)[0]
        return saved

    def add_history(self, user_id: str, data: HistoryInput):
        ai_profile = self.ai_profile(user_id)
        entry = {"id": str(uuid4()), "artwork_id": data.artwork_id,
                 "profile": (data.profile or self.profile(user_id)).model_dump(),
                 "ai_profile": ai_profile.model_dump() if ai_profile else None,
                 "viewed_at": datetime.now(timezone.utc).isoformat()}
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("INSERT INTO history (id, user_id, artwork_id, profile_json, viewed_at, ai_profile_json) VALUES (?, ?, ?, ?, ?, ?)",
                    (entry["id"], user_id, entry["artwork_id"], json.dumps(entry["profile"]), entry["viewed_at"],
                     ai_profile.model_dump_json() if ai_profile else None))
        return entry

    def history(self, user_id: str, limit: int, offset: int):
        with closing(self.connect()) as connection:
            total = connection.execute("SELECT COUNT(*) FROM history WHERE user_id = ?", (user_id,)).fetchone()[0]
            rows = connection.execute("SELECT * FROM history WHERE user_id = ? ORDER BY viewed_at DESC, id LIMIT ? OFFSET ?", (user_id, limit, offset)).fetchall()
        return {"items": [{"id": row["id"], "artwork_id": row["artwork_id"], "profile": json.loads(row["profile_json"]),
                           "ai_profile": json.loads(row["ai_profile_json"]) if row["ai_profile_json"] else None,
                           "viewed_at": row["viewed_at"]} for row in rows], "total": total, "limit": limit, "offset": offset}

    def delete_history(self, user_id: str, history_id: str):
        with closing(self.connect()) as connection:
            with connection:
                return connection.execute("DELETE FROM history WHERE id = ? AND user_id = ?", (history_id, user_id)).rowcount > 0


class RateLimiter:
    """단일 프로세스 데모 서버용. 다중 워커 배포에서는 공유 저장소로 교체한다."""
    def __init__(self, attempts=10, window=60):
        self.attempts, self.window = attempts, window
        self.entries = defaultdict(deque)
        self.lock = Lock()

    def check(self, key: str):
        now = time.monotonic()
        with self.lock:
            # 만료된 키를 정리하고 테이블 크기를 제한한다.
            if len(self.entries) >= 1000:
                for old in list(self.entries):
                    if not self.entries[old] or self.entries[old][-1] <= now - self.window:
                        del self.entries[old]
                if key not in self.entries and len(self.entries) >= 1000:
                    raise HTTPException(429, "잠시 후 다시 시도해 주세요.", headers={"Retry-After": str(self.window)})
            events = self.entries[key]
            while events and events[0] <= now - self.window:
                events.popleft()
            if len(events) >= self.attempts:
                raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", headers={"Retry-After": str(self.window)})
            events.append(now)


def create_account_router(accounts: AccountStore, catalog):
    router = APIRouter()
    bearer = HTTPBearer(auto_error=False)
    limiter = RateLimiter()

    def require_token(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if credentials is None:
            raise HTTPException(401, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
        return credentials.credentials

    def current_user(token: Annotated[str, Depends(require_token)]):
        return accounts.authenticate(token)

    def auth_limit(request: Request):
        limiter.check(request.client.host if request.client else "unknown")

    @router.post("/auth/register", response_model=LoginResult, status_code=201,
                 tags=["회원 인증"], summary="이메일로 회원가입", dependencies=[Depends(auth_limit)])
    def register(data: Registration, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return accounts.register(data)

    @router.post("/auth/login", response_model=LoginResult, tags=["회원 인증"],
                 summary="이메일·비밀번호로 로그인", dependencies=[Depends(auth_limit)])
    def login(data: Credentials, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return accounts.login(data)

    @router.post("/auth/logout", status_code=204, tags=["회원 인증"], summary="현재 세션 로그아웃")
    def logout(token: Annotated[str, Depends(require_token)]):
        accounts.authenticate(token)
        accounts.logout(token)
        return Response(status_code=204)

    @router.get("/me", response_model=User, tags=["회원 인증"], summary="로그인한 내 회원 정보 조회")
    def me(user: Annotated[dict, Depends(current_user)]):
        return user

    @router.patch("/me", response_model=User, tags=["회원 인증"], summary="내 이름(닉네임) 바꾸기")
    def update_me(data: NicknameUpdate, user: Annotated[dict, Depends(current_user)]):
        return accounts.set_nickname(user["id"], data.nickname)

    @router.get("/me/profile", response_model=VisualProfile, tags=["시각 프로필"], summary="내 시각 프로필 조회")
    def get_profile(user: Annotated[dict, Depends(current_user)]):
        return accounts.profile(user["id"])

    @router.put("/me/profile", response_model=VisualProfile, tags=["시각 프로필"], summary="내 시각 프로필 전체 저장",
                description="calibration(색 종류·세기·윤곽선)을 포함하면 앱 설정과 AI 프로필을 하나의 DB 트랜잭션으로 저장합니다. 대비·밝기·선명도는 앱에서 한 번만 적용합니다.")
    def put_profile(profile: VisualProfile, user: Annotated[dict, Depends(current_user)]):
        return accounts.set_profile(user["id"], profile)

    @router.post("/me/history", status_code=201, response_model=HistoryEntry, tags=["관람 기록"], summary="작품과 감상 당시 보정 설정 기록")
    def add_history(data: HistoryInput, user: Annotated[dict, Depends(current_user)]):
        if catalog.get(data.artwork_id) is None:
            raise HTTPException(404, "등록된 작품을 찾을 수 없습니다.")
        return accounts.add_history(user["id"], data)

    @router.get("/me/ai-profile", response_model=AIProfile | None, tags=["시각 프로필"], summary="AI 보정 프로필 조회 (미설정 시 null)")
    def get_ai_profile(user: Annotated[dict, Depends(current_user)]):
        return accounts.ai_profile(user["id"])

    @router.put("/me/ai-profile", response_model=AIProfile, tags=["시각 프로필"], summary="AI 보정 프로필 전체 저장",
                description="6필드 AI 규격. 생략한 필드는 기본값으로 저장합니다. 기존 /me/profile과 독립적이며 밝기 단위를 자동 변환하지 않습니다.")
    def put_ai_profile(profile: AIProfile, user: Annotated[dict, Depends(current_user)]):
        return accounts.set_ai_profile(user["id"], profile)

    @router.get("/me/history", response_model=HistoryList, tags=["관람 기록"], summary="내 관람 기록 목록 조회")
    def history(user: Annotated[dict, Depends(current_user)], limit: Annotated[int, Query(ge=1, le=100)] = 20,
                offset: Annotated[int, Query(ge=0)] = 0):
        return accounts.history(user["id"], limit, offset)

    @router.delete("/me/history/{history_id}", status_code=204, tags=["관람 기록"], summary="내 관람 기록 삭제")
    def delete_history(history_id: str, user: Annotated[dict, Depends(current_user)]):
        if not accounts.delete_history(user["id"], history_id):
            raise HTTPException(404, "관람 기록을 찾을 수 없습니다.")
        return Response(status_code=204)

    return router, current_user
