"""원본 작품 이미지를 '휴대폰으로 찍은 사진'처럼 바꾼다(데이터 증강).

실제 촬영본에서 생기는 변화를 흉내 낸다.
- 비스듬히 찍기(원근 왜곡), 살짝 기울이기, 작품 주변 벽·액자가 함께 찍히거나 일부가 잘림
- 조명: 밝기·대비·감마·색온도 변화, 조명 반사(밝은 얼룩)
- 흔들림·초점 흐림, 센서 노이즈, JPEG 압축
같은 seed면 항상 같은 결과가 나오도록 numpy Generator를 받는다.
"""
from io import BytesIO

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

WALL_COLORS = [(235, 232, 225), (210, 205, 195), (180, 175, 170), (60, 60, 65), (245, 245, 245), (120, 110, 100)]


def _perspective_coefficients(source, target):
    """target 사각형의 점을 source 사각형으로 옮기는 원근 변환 계수(PIL Image.transform용)."""
    matrix = []
    for (x, y), (u, v) in zip(target, source):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(matrix, dtype=np.float64)
    b = np.array(source, dtype=np.float64).reshape(8)
    return np.linalg.solve(a, b).tolist()


def place_on_wall(image, rng):
    """작품을 벽 위에 놓고(여백 0~25%) 액자 테두리를 그릴 수 있다."""
    width, height = image.size
    margin = rng.uniform(0.0, 0.25)
    if rng.random() < 0.5:
        frame = int(min(width, height) * rng.uniform(0.01, 0.05))
        tone = tuple(int(c) for c in rng.integers(20, 200, size=3))
        framed = Image.new("RGB", (width + 2 * frame, height + 2 * frame), tone)
        framed.paste(image, (frame, frame))
        image, (width, height) = framed, framed.size
    pad_x, pad_y = int(width * margin), int(height * margin)
    wall = WALL_COLORS[int(rng.integers(len(WALL_COLORS)))]
    canvas = Image.new("RGB", (width + 2 * pad_x, height + 2 * pad_y), wall)
    canvas.paste(image, (pad_x, pad_y))
    return canvas


def perspective(image, rng, strength=0.12):
    width, height = image.size
    def jitter(x, y):
        return (x + rng.uniform(-strength, strength) * width, y + rng.uniform(-strength, strength) * height)
    target = [(0, 0), (width, 0), (width, height), (0, height)]
    source = [jitter(*point) for point in target]
    fill = WALL_COLORS[int(rng.integers(len(WALL_COLORS)))]
    return image.transform((width, height), Image.Transform.PERSPECTIVE,
                           _perspective_coefficients(source, target), Image.Resampling.BICUBIC, fillcolor=fill)


def random_crop(image, rng, min_scale=0.65):
    width, height = image.size
    scale = rng.uniform(min_scale, 1.0)
    crop_w, crop_h = int(width * scale), int(height * scale)
    left = int(rng.integers(0, width - crop_w + 1))
    top = int(rng.integers(0, height - crop_h + 1))
    return image.crop((left, top, left + crop_w, top + crop_h))


def lighting(image, rng):
    image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.55, 1.3))
    image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.6, 1.3))
    image = ImageEnhance.Color(image).enhance(rng.uniform(0.7, 1.25))
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    pixels = pixels ** rng.uniform(0.8, 1.25)  # 감마
    warm = rng.uniform(-0.08, 0.08)  # 색온도: +면 따뜻하게(노랑), -면 차갑게(파랑)
    pixels *= np.array([1 + warm, 1.0, 1 - warm], dtype=np.float32)
    if rng.random() < 0.35:  # 조명 반사: 부드러운 밝은 얼룩
        h, w = pixels.shape[:2]
        cy, cx = rng.uniform(0, h), rng.uniform(0, w)
        radius = rng.uniform(0.08, 0.3) * max(h, w)
        yy, xx = np.ogrid[0:h, 0:w]
        glare = np.exp(-(((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * radius ** 2))).astype(np.float32)[..., None]
        pixels = pixels + glare * rng.uniform(0.3, 0.8)
    return Image.fromarray((np.clip(pixels, 0, 1) * 255).astype(np.uint8))


def blur_and_noise(image, rng):
    if rng.random() < 0.5:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 2.0)))
    if rng.random() < 0.25:  # 손떨림(가로 방향 흔들림)
        size = int(rng.choice([3, 5]))
        kernel = [0] * (size * size)
        row = size // 2
        for column in range(size):
            kernel[row * size + column] = 1
        image = image.filter(ImageFilter.Kernel((size, size), kernel, scale=size))
    if rng.random() < 0.5:
        pixels = np.asarray(image, dtype=np.float32)
        pixels += rng.normal(0, rng.uniform(2, 10), size=pixels.shape)
        image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    return image


def jpeg(image, rng):
    output = BytesIO()
    image.save(output, format="JPEG", quality=int(rng.integers(40, 92)))
    output.seek(0)
    with Image.open(output) as compressed:
        return compressed.convert("RGB")


def phone_capture(image, rng):
    """원본 PIL 이미지를 받아 휴대폰 촬영본처럼 바꾼 RGB 이미지를 반환한다."""
    image = image.convert("RGB")
    image.thumbnail((512, 512))
    if rng.random() < 0.6:
        image = place_on_wall(image, rng)
    if rng.random() < 0.8:
        image = perspective(image, rng)
    if rng.random() < 0.5:
        image = image.rotate(rng.uniform(-8, 8), resample=Image.Resampling.BICUBIC, expand=False,
                             fillcolor=WALL_COLORS[int(rng.integers(len(WALL_COLORS)))])
    if rng.random() < 0.6:
        image = random_crop(image, rng)
    image = lighting(image, rng)
    image = blur_and_noise(image, rng)
    return jpeg(image, rng)
