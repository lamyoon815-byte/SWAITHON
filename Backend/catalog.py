"""작품 메타데이터 저장과 로컬 카탈로그 가져오기."""

from contextlib import closing
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import sqlite3
from typing import Annotated, Literal

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


Coordinate = Annotated[float, Field(ge=0, le=1)]


class Region(BaseModel):
    label: str
    # 원본 이미지 기준 [왼쪽 x, 위쪽 y, 너비, 높이], 모두 0~1 비율.
    bbox: tuple[Coordinate, Coordinate, Coordinate, Coordinate]
    color: str

    @model_validator(mode="after")
    def check_bounds(self):
        x, y, width, height = self.bbox
        if width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
            raise ValueError("bbox는 이미지 안에 있는 양의 크기 영역이어야 합니다.")
        return self


class Description(BaseModel):
    facts: list[str]
    interpretations: list[str]
    regions: list[Region]
    mood_keywords: list[str]


class ArtworkMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,79}$")
    title: str = Field(min_length=1)
    artist: str = Field(min_length=1)
    year: str | None = None
    # 소장번호처럼 문자나 앞자리 0이 있을 수 있어 문자열로 저장한다.
    number: str | None = Field(default=None, min_length=1)
    museum: str | None = Field(default=None, min_length=1)
    background: str | None = None
    source_url: str | None = None
    license: str | None = None
    description: Description | None = None
    review_status: Literal["pending", "reviewed"] = "pending"

    @model_validator(mode="after")
    def require_reviewed_description(self):
        if self.review_status == "reviewed" and self.description is None:
            raise ValueError("검수 완료 작품에는 해설이 필요합니다.")
        return self


class ArtworkImport(ArtworkMetadata):
    image_path: Path


class ArtworkDetail(ArtworkMetadata):
    image_url: str


class ArtworkList(BaseModel):
    items: list[ArtworkDetail]
    total: int
    limit: int
    offset: int


class CatalogStore:
    def __init__(self, data_dir: Path | None = None):
        default_dir = Path(__file__).resolve().parent / "data"
        self.data_dir = Path(data_dir or os.environ.get("SWAITHON_DATA_DIR", default_dir)).resolve()
        self.images_dir = self.data_dir / "images"
        self.db_path = self.data_dir / "catalog.sqlite3"

    def initialize(self):
        self.images_dir.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as connection:
            with connection:
                connection.execute(
                    """CREATE TABLE IF NOT EXISTS artworks (
                        id TEXT PRIMARY KEY,
                        metadata_json TEXT NOT NULL,
                        image_filename TEXT NOT NULL
                    )"""
                )

    def get(self, artwork_id: str) -> dict | None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            row = connection.execute(
                "SELECT metadata_json, image_filename FROM artworks WHERE id = ?",
                (artwork_id,),
            ).fetchone()
        return self._decode(row) if row else None

    def find_by_number(self, number: str, museum: str | None = None) -> list[dict]:
        query = "SELECT metadata_json, image_filename FROM artworks WHERE json_extract(metadata_json, '$.number') = ?"
        parameters = [number]
        if museum is not None:
            query += " AND json_extract(metadata_json, '$.museum') = ?"
            parameters.append(museum)
        with closing(sqlite3.connect(self.db_path)) as connection:
            rows = connection.execute(f"{query} ORDER BY id", parameters).fetchall()
        return [self._decode(row) for row in rows]

    def export_records(self) -> list[dict]:
        """로컬 관리자 스크립트 전용. 미검수 해설을 포함한 카탈로그를 내보낸다."""
        with closing(sqlite3.connect(self.db_path)) as connection:
            rows = connection.execute("SELECT metadata_json, image_filename FROM artworks ORDER BY id").fetchall()
        return [{**json.loads(row[0]), "image_path": str(self.images_dir / row[1])} for row in rows]

    def list(self, limit: int, offset: int) -> tuple[list[dict], int]:
        with closing(sqlite3.connect(self.db_path)) as connection:
            total = connection.execute("SELECT COUNT(*) FROM artworks").fetchone()[0]
            rows = connection.execute(
                "SELECT metadata_json, image_filename FROM artworks ORDER BY id LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [self._decode(row) for row in rows], total

    @staticmethod
    def _decode(row) -> dict:
        record = ArtworkMetadata.model_validate_json(row[0]).model_dump(mode="json")
        # 미검수 해설은 DB에 보관하되 앱에는 노출하지 않는다.
        if record["review_status"] != "reviewed":
            record["description"] = None
        record["image_filename"] = row[1]
        return record

    def import_manifest(self, manifest_path: Path) -> int:
        manifest_path = manifest_path.resolve()
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        records = TypeAdapter(list[ArtworkImport]).validate_python(raw)
        if len({record.id for record in records}) != len(records):
            raise ValueError("카탈로그에 중복된 작품 ID가 있습니다.")

        # 전체 입력을 검증한 다음 DB를 변경한다.
        prepared = []
        for record in records:
            source = (manifest_path.parent / record.image_path).resolve()
            with Image.open(source) as image:
                extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(image.format)
                if extension is None:
                    raise ValueError(f"{record.id}: 원본 서빙용 이미지는 JPEG/PNG/WebP여야 합니다.")
                image.verify()
            with Image.open(source) as image:
                image.load()
            digest = sha256(source.read_bytes()).hexdigest()
            filename = f"{digest}{extension}"
            metadata = ArtworkMetadata.model_validate(record.model_dump(exclude={"image_path"}))
            prepared.append((metadata, source, filename))

        self.initialize()
        with closing(sqlite3.connect(self.db_path)) as connection:
            rows = connection.execute(
                "SELECT id, json_extract(metadata_json, '$.museum'), json_extract(metadata_json, '$.number') FROM artworks"
            ).fetchall()
            # 이번에 갱신되는 작품은 새 값으로 비교한다.
            numbers = {row[0]: (row[1], row[2]) for row in rows}
            numbers.update({metadata.id: (metadata.museum, metadata.number) for metadata, _, _ in prepared})
            assigned = [value for value in numbers.values() if value[1] is not None]
            if len(set(assigned)) != len(assigned):
                raise ValueError("같은 미술관에 중복된 작품 번호가 있습니다.")
            with connection:
                for metadata, source, filename in prepared:
                    destination = self.images_dir / filename
                    if not destination.exists():
                        # 사용자 원본은 변환하지 않고 그대로 복사한다.
                        shutil.copyfile(source, destination)
                    connection.execute(
                        """INSERT INTO artworks (id, metadata_json, image_filename)
                           VALUES (?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             metadata_json = excluded.metadata_json,
                             image_filename = excluded.image_filename""",
                        (metadata.id, metadata.model_dump_json(), filename),
                    )
        return len(prepared)
