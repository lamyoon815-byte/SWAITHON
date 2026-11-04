"""CLIP CPU 임베딩, 카탈로그 인덱스, 명패 텍스트 매칭."""

from io import BytesIO
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from threading import RLock
import unicodedata

from fastapi import HTTPException
import numpy as np
from PIL import Image, ImageOps
from rapidfuzz import fuzz


def image_quality(content: bytes) -> dict:
    with Image.open(BytesIO(content)) as source:
        source.thumbnail((512, 512))
        pixels = np.asarray(source.convert("RGB"), dtype=np.float32)
    gray = pixels.mean(axis=2)
    padded = np.pad(gray, 1, mode="edge")
    laplacian = padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:] - 4 * gray
    variance = float(laplacian.var())
    highlights = float(np.mean(np.all(pixels >= 245, axis=2)))
    warnings = []
    if variance < 50:
        warnings.append("흐릴 수 있습니다. 초점을 맞춰 다시 촬영해 보세요.")
    if highlights > 0.2:
        warnings.append("밝은 영역이 많습니다. 반사광이 있는지 확인해 주세요.")
    return {"laplacian_variance": variance, "highlight_ratio": highlights,
            "warnings": warnings, "note": "품질 경고는 규칙 기반 참고값이며 인식을 차단하지 않습니다."}


class ClipEncoder:
    def __init__(self, data_dir: Path):
        self.model_name = os.environ.get("CLIP_MODEL", "ViT-B-32-quickgelu")
        self.pretrained = os.environ.get("CLIP_PRETRAINED", "openai")
        self.cache_dir = data_dir / "model-cache"
        self.lock = RLock()
        self.model = None

    def encode(self, content: bytes) -> np.ndarray:
        with self.lock:
            try:
                import open_clip
                import torch
            except ImportError as exc:
                raise HTTPException(503, "CLIP 의존성이 없습니다. requirements-ai.txt를 설치해 주세요.") from exc
            if self.model is None:
                try:
                    torch.set_num_threads(2)
                    self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                        self.model_name, pretrained=self.pretrained, device="cpu", cache_dir=str(self.cache_dir)
                    )
                    self.model.eval()
                except Exception as exc:
                    raise HTTPException(503, "CLIP 모델을 불러오지 못했습니다. 모델 설정·캐시·네트워크를 확인해 주세요.") from exc
            with Image.open(BytesIO(content)) as source:
                with ImageOps.exif_transpose(source) as oriented:
                    with oriented.convert("RGB") as image:
                        tensor = self.preprocess(image).unsqueeze(0)
            with torch.inference_mode():
                features = self.model.encode_image(tensor)
                features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            return features.cpu().numpy()[0].astype(np.float32)


class RecognitionService:
    def __init__(self, catalog, encoder=None):
        self.catalog = catalog
        self.encoder = encoder or ClipEncoder(catalog.data_dir)
        self.index_path = catalog.data_dir / "artwork-index.npz"
        self.lock = RLock()
        self.cached_index = None
        self.cached_stat = None
        configured = os.environ.get("CLIP_MATCH_THRESHOLD", "").strip()
        self.match_threshold = float(configured) if configured else None
        if self.match_threshold is not None and not -1 <= self.match_threshold <= 1:
            raise ValueError("CLIP_MATCH_THRESHOLD는 -1~1 사이의 유한한 값이어야 합니다.")

    def build_index(self):
        records, _ = self.catalog.list(100000, 0)
        if not records:
            raise ValueError("등록된 작품이 없습니다. 카탈로그를 먼저 등록해 주세요.")
        vectors = [self.encoder.encode((self.catalog.images_dir / row["image_filename"]).read_bytes()) for row in records]
        matrix = np.stack(vectors).astype(np.float32)
        if not np.isfinite(matrix).all() or np.any(np.linalg.norm(matrix, axis=1) == 0):
            raise ValueError("유효하지 않은 임베딩입니다.")
        matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
        self.catalog.data_dir.mkdir(parents=True, exist_ok=True)
        # 읽는 중인 서버가 반쯤 작성된 인덱스를 보지 않도록 원자적으로 교체한다.
        with NamedTemporaryFile(dir=self.catalog.data_dir, suffix=".npz", delete=False) as handle:
            temporary = Path(handle.name)
        try:
            np.savez_compressed(temporary, vectors=matrix, ids=np.array([r["id"] for r in records]),
                filenames=np.array([r["image_filename"] for r in records]),
                model=np.array(self.encoder.model_name), pretrained=np.array(self.encoder.pretrained))
            temporary.replace(self.index_path)
        finally:
            temporary.unlink(missing_ok=True)
        return len(records)

    def _load_index(self, records):
        try:
            stat = self.index_path.stat()
            version = (stat.st_mtime_ns, stat.st_size)
            if self.cached_index is None or self.cached_stat != version:
                with np.load(self.index_path, allow_pickle=False) as data:
                    self.cached_index = {key: data[key].copy() for key in ("vectors", "ids", "filenames", "model", "pretrained")}
                self.cached_stat = version
        except (OSError, ValueError, KeyError) as exc:
            raise HTTPException(503, "작품 인덱스가 없습니다/손상됐습니다. build_index.py를 실행해 주세요.") from exc
        data = self.cached_index
        if str(data["model"]) != self.encoder.model_name or str(data["pretrained"]) != self.encoder.pretrained:
            raise HTTPException(503, "CLIP 모델 설정과 인덱스가 다릅니다. 인덱스를 다시 생성해 주세요.")
        expected = [(r["id"], r["image_filename"]) for r in records]
        actual = list(zip(data["ids"].tolist(), data["filenames"].tolist()))
        vectors = data["vectors"]
        if actual != expected:
            raise HTTPException(503, "카탈로그가 변경됐습니다. 작품 인덱스를 다시 생성해 주세요.")
        if vectors.ndim != 2 or vectors.shape[0] != len(actual) or not np.isfinite(vectors).all():
            raise HTTPException(503, "임베딩 인덱스 형식이 잘못되었습니다.")
        norms = np.linalg.norm(vectors, axis=1)
        if np.any(norms == 0):
            raise HTTPException(503, "임베딩 인덱스에 빈 벡터가 있습니다.")
        return vectors / norms[:, None]

    def recognize_artwork(self, content: bytes):
        with self.lock:
            records, _ = self.catalog.list(100000, 0)
            if not records:
                raise HTTPException(503, "등록된 작품이 없습니다. 카탈로그를 먼저 등록해 주세요.")
            vectors = self._load_index(records)
            query = np.asarray(self.encoder.encode(content), dtype=np.float32)
            norm = np.linalg.norm(query)
            if query.shape != (vectors.shape[1],) or not np.isfinite(query).all() or norm == 0:
                raise HTTPException(503, "CLIP 임베딩 차원 또는 값이 인덱스와 다릅니다.")
            scores = vectors @ (query / norm)
            order = np.argsort(-scores, kind="stable")[:3]
            return [{"artwork_id": records[int(i)]["id"], "title": records[int(i)]["title"],
                     "artist": records[int(i)]["artist"], "score": float(np.clip(scores[i], -1, 1))} for i in order]

    def match_placard(self, title: str, artist: str, text: str):
        def normalize(value):
            return re.sub(r"[^\w]", "", unicodedata.normalize("NFKC", value).casefold())
        title, artist, text = map(normalize, (title, artist, text))
        if not title and not text:
            return []
        records, _ = self.catalog.list(100000, 0)
        results = []
        for record in records:
            title_score = fuzz.WRatio(title or text, normalize(record["title"]))
            score = 0.8 * title_score + 0.2 * fuzz.WRatio(artist, normalize(record["artist"])) if artist else title_score
            if score >= 60:
                results.append({"artwork_id": record["id"], "title": record["title"], "artist": record["artist"], "score": score / 100})
        return sorted(results, key=lambda row: (-row["score"], row["artwork_id"]))[:3]
