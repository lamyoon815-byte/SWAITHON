"""CLIP-Adapter(Gao et al., 2021) 방식의 작은 잔차 어댑터를 서버에서 적용한다.

CLIP 본체는 그대로 두고, 이미지 임베딩 뒤에 붙인 작은 층만 학습한 결과를 불러온다.
    adapted = normalize(alpha * MLP(x) + (1 - alpha) * x),  MLP(x) = relu(x W1 + b1) W2 + b2
학습은 Backend/ai/finetune/train_adapter.py에서 하고, 결과는 data/clip-adapter.npz로 저장한다.
서버는 torch 없이 numpy로만 계산하므로 추가 지연이 거의 없다.
"""
import hashlib
import json
from pathlib import Path
import warnings

import numpy as np

ADAPTER_FILENAME = "clip-adapter.npz"
REQUIRED_KEYS = ("w1", "b1", "w2", "b2", "alpha", "model", "pretrained")


class ClipAdapter:
    def __init__(self, w1, b1, w2, b2, alpha, model, pretrained, metrics=None):
        self.w1 = np.asarray(w1, dtype=np.float32)
        self.b1 = np.asarray(b1, dtype=np.float32)
        self.w2 = np.asarray(w2, dtype=np.float32)
        self.b2 = np.asarray(b2, dtype=np.float32)
        self.alpha = float(alpha)
        self.model = str(model)
        self.pretrained = str(pretrained)
        self.metrics = metrics or {}
        dim, hidden = self.w1.shape
        if self.b1.shape != (hidden,) or self.w2.shape != (hidden, dim) or self.b2.shape != (dim,):
            raise ValueError("어댑터 가중치 형태가 올바르지 않습니다.")
        if not 0 <= self.alpha <= 1:
            raise ValueError("어댑터 alpha는 0~1이어야 합니다.")
        arrays = (self.w1, self.b1, self.w2, self.b2)
        if not all(np.isfinite(array).all() for array in arrays):
            raise ValueError("어댑터 가중치에 유한하지 않은 값이 있습니다.")
        digest = hashlib.sha256()
        for array in arrays:
            digest.update(np.ascontiguousarray(array).tobytes())
        digest.update(repr(self.alpha).encode())
        # 인덱스와 어댑터가 같은 버전인지 확인하는 데 쓰는 짧은 지문
        self.fingerprint = digest.hexdigest()[:16]

    @property
    def dim(self):
        return self.w1.shape[0]

    def apply(self, vectors):
        """(N, D) 또는 (D,) 정규화 임베딩에 어댑터를 적용하고 다시 정규화한다."""
        x = np.asarray(vectors, dtype=np.float32)
        single = x.ndim == 1
        if single:
            x = x[None, :]
        if x.shape[1] != self.dim:
            raise ValueError("어댑터 입력 차원이 CLIP 임베딩 차원과 다릅니다.")
        hidden = np.maximum(x @ self.w1 + self.b1, 0)
        mixed = self.alpha * (hidden @ self.w2 + self.b2) + (1 - self.alpha) * x
        mixed /= np.clip(np.linalg.norm(mixed, axis=1, keepdims=True), 1e-12, None)
        return mixed[0] if single else mixed

    def save(self, path: Path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, w1=self.w1, b1=self.b1, w2=self.w2, b2=self.b2, alpha=np.array(self.alpha),
                 model=np.array(self.model), pretrained=np.array(self.pretrained),
                 metrics=np.array(json.dumps(self.metrics, ensure_ascii=False)))

    @classmethod
    def load(cls, path: Path):
        with np.load(path, allow_pickle=False) as data:
            missing = [key for key in REQUIRED_KEYS if key not in data]
            if missing:
                raise ValueError(f"어댑터 파일에 {missing} 값이 없습니다.")
            metrics = json.loads(str(data["metrics"])) if "metrics" in data else {}
            return cls(data["w1"], data["b1"], data["w2"], data["b2"], float(data["alpha"]),
                       str(data["model"]), str(data["pretrained"]), metrics)


def load_optional_adapter(path: Path, model_name: str, pretrained: str, enabled: bool = True):
    """어댑터 파일이 있으면 불러오고, 없거나 꺼져 있으면 None(기존 CLIP 그대로)을 반환한다."""
    path = Path(path)
    if not enabled or not path.exists():
        return None
    try:
        adapter = ClipAdapter.load(path)
    except (OSError, ValueError) as exc:
        warnings.warn(f"어댑터 파일을 읽지 못해 원래 CLIP만 사용합니다: {exc}")
        return None
    if (adapter.model, adapter.pretrained) != (model_name, pretrained):
        # 서버 전체가 멈추지 않도록 어댑터만 끈다. 인덱스가 어댑터로 만들어졌다면 인식 API가 재생성을 안내한다.
        warnings.warn(
            f"어댑터는 {adapter.model}/{adapter.pretrained}용으로 학습됐지만 서버 CLIP 설정은 "
            f"{model_name}/{pretrained}입니다. 어댑터를 쓰지 않습니다. 같은 모델로 다시 학습하세요."
        )
        return None
    return adapter
