"""색 구분 검사판(점으로 숫자를 그린 그림)을 직접 만든다.

이시하라 검사표와 같은 원리(가성동색표)지만 그림은 전부 코드로 새로 만든다.
- 숫자 점과 바탕 점의 색 차이를 Machado(2009) 색각이상 행렬이 거의 지우는 방향으로만 준다.
  그래서 정상 시각에는 숫자가 보이고, 해당 색각이상 시뮬레이션에서는 숫자가 사라진다.
- 점마다 밝기를 무작위로 바꿔, 밝기 차이만으로는 숫자를 읽을 수 없게 한다.
- 이 그림에 correction.py 보정을 단계별로 적용하면, 시뮬레이션에서도 숫자가 다시 나타난다.

의료용 검사가 아니라, 앱에서 보정 세기를 고르는 데 쓰는 그림이다.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .correction import cvd_matrix, linear_to_srgb

# 바탕색(선형 RGB)과 숫자 쪽으로 옮기는 거리. 정상 시각에서 숫자가 뚜렷하고 색 범위를 넘지 않게 정했다.
PLATE_COLORS = {"protan": ((0.20, 0.27, 0.05), 0.42),   # 올리브 바탕 + 주황 숫자
                "deutan": ((0.18, 0.28, 0.06), 0.40),   # 올리브 바탕 + 빨강 숫자
                "tritan": ((0.36, 0.34, 0.08), 0.38)}   # 노랑 바탕 + 보라 숫자
FONTS = ("arialbd.ttf", "C:/Windows/Fonts/arialbd.ttf", "DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf")


def confusion_direction(color_type):
    """색각이상 행렬이 가장 많이 지우는 색 방향(가장 작은 특이값의 벡터)."""
    vector = np.linalg.svd(cvd_matrix(color_type, 1.0))[2][-1]
    index = 2 if color_type == "tritan" else 0  # 숫자가 빨강(또는 파랑) 쪽으로 가게 부호를 맞춘다.
    return vector if vector[index] > 0 else -vector


def _font(size):
    for name in FONTS:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    raise RuntimeError("굵은 글꼴을 찾지 못했습니다.")


def _number_mask(text, size):
    mask = Image.new("L", (size, size), 0)
    draw, font = ImageDraw.Draw(mask), _font(int(size * 0.5))
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((size - box[2] + box[0]) / 2 - box[0], (size - box[3] + box[1]) / 2 - box[1]), text, font=font, fill=255)
    return np.asarray(mask) > 0


def _dots(rng, size):
    """원 안을 겹치지 않는 크고 작은 점으로 채운다."""
    center, radius, cell = size / 2, size * 0.47, size / 32
    grid, dots = {}, []
    for _ in range(60000):
        r = rng.uniform(size / 180, size / 60)
        x, y = rng.uniform(center - radius, center + radius, 2)
        if (x - center) ** 2 + (y - center) ** 2 > (radius - r) ** 2:
            continue
        gx, gy = int(x // cell), int(y // cell)
        near = (d for i in range(gx - 1, gx + 2) for j in range(gy - 1, gy + 2) for d in grid.get((i, j), ()))
        if all((x - x2) ** 2 + (y - y2) ** 2 >= (r + r2 + 2) ** 2 for x2, y2, r2 in near):
            grid.setdefault((gx, gy), []).append((x, y, r))
            dots.append((x, y, r))
    return dots


def make_plate(color_type, number, seed, size=720):
    """(RGB 0~1 float 배열, 점 목록[(x, y, 숫자 점인지)])을 반환한다."""
    rng = np.random.default_rng(seed)
    base, distance = PLATE_COLORS[color_type]
    base = np.array(base)
    figure = base + distance * confusion_direction(color_type)
    mask = _number_mask(str(number), size)
    image = Image.new("RGB", (size, size), "white")
    draw, dots = ImageDraw.Draw(image), []
    for x, y, r in _dots(rng, size):
        is_figure = bool(mask[int(y), int(x)])
        linear = (figure if is_figure else base) * rng.uniform(0.65, 1.3) + rng.normal(0, 0.012, 3)
        rgb = linear_to_srgb(np.clip(linear, 0, 1)[None, None, :].astype(np.float32))[0, 0]
        draw.ellipse((x - r, y - r, x + r, y + r), fill=tuple(int(round(v * 255)) for v in np.clip(rgb, 0, 1)))
        dots.append((x, y, is_figure))
    return np.asarray(image, dtype=np.float32) / 255, dots


def number_contrast(rgb, dots):
    """숫자 점 평균색과 바탕 점 평균색의 CIELAB 색 차이(ΔE). 클수록 숫자가 잘 보인다."""
    import cv2
    lab = cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2LAB)
    values = np.array([lab[int(y), int(x)] for x, y, _ in dots])
    figure = np.array([is_figure for *_, is_figure in dots])
    return float(np.linalg.norm(values[figure].mean(axis=0) - values[~figure].mean(axis=0)))
