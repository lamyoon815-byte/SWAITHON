"""작품 인식용 '기준 사진' 만들기 (작품마다 기준 사진을 여러 장 등록해 비교).

등록 작품 1점마다 기준 사진을 여러 장 만든다.
    [원본, 가운데 90% 자르기, 가운데 80% 자르기] + 휴대폰 촬영처럼 바꾼 사진 N장(finetune/augment.py)
촬영본의 작품별 점수는 그 작품 기준 사진들 점수 중 가장 높은 값(max)으로 정한다. 다시 학습하지 않는다.
variants=0이면 원본 1장만 써서 지금과 똑같이 동작한다.

평가(ai/evaluation.py)와 서버 색인이 이 파일 하나를 함께 써야, 평가한 것과 서버가 같은 기준 사진을 쓴다.
"""
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

REFERENCE_SEED = 20261112
CROP_SCALES = (0.9, 0.8)
JPEG_QUALITY = 95


def center_crop(image, scale):
    """가운데를 남기고 가로·세로를 scale배로 자른다."""
    width, height = image.size
    crop_w, crop_h = max(1, round(width * scale)), max(1, round(height * scale))
    left, top = (width - crop_w) // 2, (height - crop_h) // 2
    return image.crop((left, top, left + crop_w, top + crop_h))


def reference_images(image, variants: int, index: int) -> list:
    """기준 사진(PIL 이미지) 목록. index는 카탈로그에서 작품의 순서로, 같은 index면 항상 같은 사진이 나온다."""
    original = image.convert("RGB")
    if variants <= 0:
        return [original]
    from .finetune.augment import phone_capture  # augment.py는 바꾸지 않고 그대로 쓴다.
    rng = np.random.default_rng(REFERENCE_SEED + index)
    crops = [center_crop(original, scale) for scale in CROP_SCALES]
    return [original, *crops, *(phone_capture(original, rng) for _ in range(variants))]


def reference_contents(content: bytes, variants: int, index: int) -> list[bytes]:
    """CLIP 인코더(encode)에 넣을 기준 사진 바이트 목록.

    첫 장은 원본 파일 바이트를 그대로 둔다(variants=0이면 지금과 똑같은 결과). 나머지는 JPEG로 만든다.
    """
    if variants <= 0:
        return [content]
    with Image.open(BytesIO(content)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    contents = [content]
    for extra in reference_images(image, variants, index)[1:]:
        output = BytesIO()
        extra.save(output, format="JPEG", quality=JPEG_QUALITY)
        contents.append(output.getvalue())
    return contents


def max_per_owner(scores, owners, count: int):
    """기준 사진별 점수(…, 기준 사진 수)를 작품별 점수(…, count)로 줄인다: 같은 작품 기준 사진 중 최댓값."""
    scores = np.asarray(scores)
    owners = np.asarray(owners)
    reduced = np.full(scores.shape[:-1] + (count,), -np.inf, dtype=scores.dtype)
    for owner in range(count):
        rows = owners == owner
        if rows.any():
            reduced[..., owner] = scores[..., rows].max(axis=-1)
    return reduced
