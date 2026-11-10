"""CLIP 제로샷 분류로 '작품을 찍은 사진인지'를 판별한다.

작품 인식에 이미 계산한 CLIP 이미지 임베딩을 그대로 쓰고, 문장 임베딩은 처음 한 번만 계산해 두므로
추가로 드는 시간은 행렬 곱 한 번 정도다. (CLIP 제로샷 분류: Radford et al., 2021)
손·바닥·키보드처럼 작품이 아닌 사진이면 다시 찍어 달라고 안내하는 데 쓴다.
"""
from threading import Lock

import numpy as np

# 앞쪽은 작품 사진, 뒤쪽은 작품이 아닌 사진을 설명하는 문장이다.
ARTWORK_PROMPTS = [
    "a photo of a painting",
    "a photo of a framed painting hanging on a wall",
    "a photo of a painting shown on a computer monitor",
    "a photo of a woodblock print",
    "a photo of an engraving or etching",
    "a photo of a drawing on paper",
    "a photo of an artwork in a museum",
    "a photo of a famous painting",
]
NON_ARTWORK_PROMPTS = [
    "a photo of a hand",
    "a close-up photo of fingers",
    "a photo of a person's face",
    "a selfie",
    "a photo of a floor",
    "a photo of a ceiling",
    "a photo of a blank wall",
    "a photo of a computer keyboard",
    "a photo of a desk",
    "a photo of a room",
    "a completely dark photo",
    "a blurry photo of nothing in particular",
    "a photo of a document with text",
    "a photo of a smartphone home screen",
    "a photo of food",
    "a photo of a street",
    "a photo of a pet",
]
# CLIP 학습 때 쓴 온도(logit scale)와 같은 값. 확률 분포를 날카롭게 만든다.
LOGIT_SCALE = 100.0


class ArtworkGate:
    def __init__(self, encoder, threshold: float):
        if not 0 < threshold < 1:
            raise ValueError("ARTWORK_GATE_THRESHOLD는 0과 1 사이여야 합니다.")
        self.encoder = encoder
        self.threshold = threshold
        self.lock = Lock()
        self.text_vectors = None

    def _texts(self):
        with self.lock:
            if self.text_vectors is None:
                vectors = np.asarray(self.encoder.encode_texts(ARTWORK_PROMPTS + NON_ARTWORK_PROMPTS), dtype=np.float32)
                vectors /= np.clip(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12, None)
                self.text_vectors = vectors
            return self.text_vectors

    def warmup(self):
        self._texts()

    def artwork_probability(self, raw_image_vector) -> float:
        """정규화된 '원래 CLIP' 이미지 임베딩(어댑터 적용 전)을 받아 작품 사진일 확률(0~1)을 반환한다."""
        texts = self._texts()
        vector = np.asarray(raw_image_vector, dtype=np.float32)
        vector = vector / max(float(np.linalg.norm(vector)), 1e-12)
        logits = LOGIT_SCALE * (texts @ vector)
        logits -= logits.max()
        probs = np.exp(logits)
        probs /= probs.sum()
        return float(probs[: len(ARTWORK_PROMPTS)].sum())

    def is_artwork(self, probability: float) -> bool:
        return probability >= self.threshold
