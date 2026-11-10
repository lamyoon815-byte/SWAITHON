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

if __package__:
    from .ai.adapter import ADAPTER_FILENAME, load_optional_adapter
    from .ai.artwork_gate import ArtworkGate
else:
    from ai.adapter import ADAPTER_FILENAME, load_optional_adapter
    from ai.artwork_gate import ArtworkGate


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

    def _load(self):
        try:
            import open_clip
            import torch
        except ImportError as exc:
            raise HTTPException(503, "CLIP 의존성이 없습니다. requirements-ai.txt를 설치해 주세요.") from exc
        if self.model is None:
            try:
                torch.set_num_threads(int(os.environ.get("CLIP_NUM_THREADS", "2")))
                self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                    self.model_name, pretrained=self.pretrained, device="cpu", cache_dir=str(self.cache_dir)
                )
                self.model.eval()
                self.tokenizer = open_clip.get_tokenizer(self.model_name)
            except Exception as exc:
                raise HTTPException(503, "CLIP 모델을 불러오지 못했습니다. 모델 설정·캐시·네트워크를 확인해 주세요.") from exc
        return torch

    def encode(self, content: bytes) -> np.ndarray:
        """원래 CLIP 이미지 임베딩(정규화)을 반환한다. 어댑터는 RecognitionService에서 적용한다."""
        with self.lock:
            torch = self._load()
            with Image.open(BytesIO(content)) as source:
                # 큰 휴대폰 사진은 JPEG를 축소해서 읽어 디코딩 시간을 줄인다. (CLIP 입력은 224px)
                source.draft("RGB", (448, 448))
                with ImageOps.exif_transpose(source) as oriented:
                    with oriented.convert("RGB") as image:
                        tensor = self.preprocess(image).unsqueeze(0)
            with torch.inference_mode():
                features = self.model.encode_image(tensor)
                features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            return features.cpu().numpy()[0].astype(np.float32)

    def encode_texts(self, texts: list[str]) -> np.ndarray:
        """작품 판별용 문장 임베딩(정규화)을 반환한다."""
        with self.lock:
            torch = self._load()
            with torch.inference_mode():
                features = self.model.encode_text(self.tokenizer(texts))
                features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            return features.cpu().numpy().astype(np.float32)

    def warmup(self):
        with self.lock:
            self._load()


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
        configured_high = os.environ.get("CLIP_HIGH_CONFIDENCE_THRESHOLD", "").strip()
        self.high_confidence_threshold = float(configured_high) if configured_high else None
        if self.high_confidence_threshold is not None and (
            self.match_threshold is None or not self.match_threshold <= self.high_confidence_threshold <= 1
        ):
            raise ValueError("high 기준은 match 기준 설정 후 match 이상 1 이하로 설정해야 합니다.")
        if self.match_threshold is not None and not -1 <= self.match_threshold <= 1:
            raise ValueError("CLIP_MATCH_THRESHOLD는 -1~1 사이의 유한한 값이어야 합니다.")
        # 파인튜닝한 어댑터(data/clip-adapter.npz)가 있으면 적용한다. CLIP_ADAPTER=off로 끌 수 있다.
        self.adapter = load_optional_adapter(
            catalog.data_dir / ADAPTER_FILENAME, getattr(self.encoder, "model_name", ""),
            getattr(self.encoder, "pretrained", ""),
            enabled=os.environ.get("CLIP_ADAPTER", "on").strip().lower() not in {"off", "0", "false"})
        # 손·바닥 같은 '작품이 아닌 사진' 판별. 문장 임베딩을 만들 수 있는 인코더에서만 켠다.
        gate_value = os.environ.get("ARTWORK_GATE_THRESHOLD", "0.5").strip()
        self.gate = None
        if gate_value.lower() not in {"off", ""} and hasattr(self.encoder, "encode_texts"):
            self.gate = ArtworkGate(self.encoder, float(gate_value))

    @property
    def adapter_id(self):
        return self.adapter.fingerprint if self.adapter is not None else "none"

    @property
    def gate_threshold(self):
        return self.gate.threshold if self.gate is not None else None

    def _adapt(self, vectors):
        return self.adapter.apply(vectors) if self.adapter is not None else vectors

    def warmup(self):
        """서버 시작 때 모델·문장 임베딩·인덱스를 미리 불러 첫 요청을 빠르게 한다."""
        if hasattr(self.encoder, "warmup"):
            self.encoder.warmup()
        if self.gate is not None:
            self.gate.warmup()
        records, _ = self.catalog.list(100000, 0)
        if records and self.index_path.exists():
            self._load_index(records)

    def build_index(self):
        records, _ = self.catalog.list(100000, 0)
        if not records:
            raise ValueError("등록된 작품이 없습니다. 카탈로그를 먼저 등록해 주세요.")
        vectors = [self.encoder.encode((self.catalog.images_dir / row["image_filename"]).read_bytes()) for row in records]
        matrix = np.stack(vectors).astype(np.float32)
        if not np.isfinite(matrix).all() or np.any(np.linalg.norm(matrix, axis=1) == 0):
            raise ValueError("유효하지 않은 임베딩입니다.")
        matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
        matrix = np.asarray(self._adapt(matrix), dtype=np.float32)
        self.catalog.data_dir.mkdir(parents=True, exist_ok=True)
        # 읽는 중인 서버가 반쯤 작성된 인덱스를 보지 않도록 원자적으로 교체한다.
        with NamedTemporaryFile(dir=self.catalog.data_dir, suffix=".npz", delete=False) as handle:
            temporary = Path(handle.name)
        try:
            np.savez_compressed(temporary, vectors=matrix, ids=np.array([r["id"] for r in records]),
                filenames=np.array([r["image_filename"] for r in records]),
                model=np.array(self.encoder.model_name), pretrained=np.array(self.encoder.pretrained),
                adapter=np.array(self.adapter_id))
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
                    # 어댑터 도입 전에 만든 인덱스는 어댑터 없이 만든 것으로 본다.
                    self.cached_index["adapter"] = data["adapter"].copy() if "adapter" in data else np.array("none")
                self.cached_stat = version
        except (OSError, ValueError, KeyError) as exc:
            raise HTTPException(503, "작품 인덱스가 없습니다/손상됐습니다. build_index.py를 실행해 주세요.") from exc
        data = self.cached_index
        if str(data["model"]) != self.encoder.model_name or str(data["pretrained"]) != self.encoder.pretrained:
            raise HTTPException(503, "CLIP 모델 설정과 인덱스가 다릅니다. 인덱스를 다시 생성해 주세요.")
        if str(data["adapter"]) != self.adapter_id:
            raise HTTPException(503, "파인튜닝 어댑터와 인덱스가 다릅니다. build_index.py로 인덱스를 다시 생성해 주세요.")
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
        return self.recognize_photo(content)["candidates"]

    def recognize_photo(self, content: bytes):
        """CLIP 임베딩을 한 번만 계산해 작품 후보(어댑터 적용)와 작품 사진 확률(원래 CLIP)을 함께 구한다."""
        with self.lock:
            records, _ = self.catalog.list(100000, 0)
            if not records:
                raise HTTPException(503, "등록된 작품이 없습니다. 카탈로그를 먼저 등록해 주세요.")
            vectors = self._load_index(records)
            raw = np.asarray(self.encoder.encode(content), dtype=np.float32)
            norm = np.linalg.norm(raw)
            if raw.shape != (vectors.shape[1],) or not np.isfinite(raw).all() or norm == 0:
                raise HTTPException(503, "CLIP 임베딩 차원 또는 값이 인덱스와 다릅니다.")
            raw = raw / norm
            probability = self.gate.artwork_probability(raw) if self.gate is not None else None
            scores = vectors @ np.asarray(self._adapt(raw), dtype=np.float32)
            order = np.argsort(-scores, kind="stable")[:3]
            candidates = [{"artwork_id": records[int(i)]["id"], "title": records[int(i)]["title"],
                           "artist": records[int(i)]["artist"], "score": float(np.clip(scores[i], -1, 1))} for i in order]
            return {"candidates": candidates, "artwork_probability": probability}

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
