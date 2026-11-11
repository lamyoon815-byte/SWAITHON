"""시각 프로필에 맞춰 작품 이미지를 보정한다. (서버 /correction API가 호출하는 함수)

계약: correct_image(RGB JPEG bytes, AIProfile dict) -> 같은 크기의 JPEG bytes

보정 순서 (색을 먼저 바로잡고, 밝기·선명도를 조정한 뒤, 윤곽선은 마지막에 덧그려 다른 보정에 뭉개지지 않게 한다)
1. 색각이상 색 보정 (color_type, severity)
   Machado(2009) 모델로 '이 사용자에게 보이는 색'을 계산하고, 원본과의 차이(구분되지 않는 색 정보)를
   사용자가 구분할 수 있는 채널로 옮겨 더한다(달토나이제이션, Fidaner et al. 2005 방식).
   Machado 행렬은 선형 RGB 기준이므로 sRGB → 선형 → 보정 → sRGB로 변환한다.
2. 밝기·대비 (brightness -50~50, contrast 0.5~2): CIELAB 밝기(L*) 채널에만 적용해 색이 틀어지지 않게 한다.
3. 선명도 (sharpness 0~2): 언샤프 마스크.
4. 선 두께·윤곽선 강조 (edge 0~1): Canny로 윤곽선을 찾고 팽창(dilation)으로 굵게 만든 뒤,
   밝은 곳에는 어두운 선, 어두운 곳에는 밝은 선으로 덧그린다. edge가 클수록 선이 굵고 진하다.
"""
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

# Machado, Oliveira & Fernandes (2009) 색각이상 시뮬레이션 행렬 (선형 RGB, 정도 0.0~1.0, 0.1 간격)
# 출처: colour-science 0.4.6 colour/blindness/datasets/machado2010.py
# Copyright 2013 Colour Developers, BSD-3-Clause (https://opensource.org/licenses/BSD-3-Clause)
MACHADO_2009 = {
    "protan": [
        [[1.000000, 0.000000, -0.000000], [0.000000, 1.000000, 0.000000], [-0.000000, -0.000000, 1.000000]],
        [[0.856167, 0.182038, -0.038205], [0.029342, 0.955115, 0.015544], [-0.002880, -0.001563, 1.004443]],
        [[0.734766, 0.334872, -0.069637], [0.051840, 0.919198, 0.028963], [-0.004928, -0.004209, 1.009137]],
        [[0.630323, 0.465641, -0.095964], [0.069181, 0.890046, 0.040773], [-0.006308, -0.007724, 1.014032]],
        [[0.539009, 0.579343, -0.118352], [0.082546, 0.866121, 0.051332], [-0.007136, -0.011959, 1.019095]],
        [[0.458064, 0.679578, -0.137642], [0.092785, 0.846313, 0.060902], [-0.007494, -0.016807, 1.024301]],
        [[0.385450, 0.769005, -0.154455], [0.100526, 0.829802, 0.069673], [-0.007442, -0.022190, 1.029632]],
        [[0.319627, 0.849633, -0.169261], [0.106241, 0.815969, 0.077790], [-0.007025, -0.028051, 1.035076]],
        [[0.259411, 0.923008, -0.182420], [0.110296, 0.804340, 0.085364], [-0.006276, -0.034346, 1.040622]],
        [[0.203876, 0.990338, -0.194214], [0.112975, 0.794542, 0.092483], [-0.005222, -0.041043, 1.046265]],
        [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    ],
    "deutan": [
        [[1.000000, 0.000000, -0.000000], [0.000000, 1.000000, 0.000000], [-0.000000, -0.000000, 1.000000]],
        [[0.866435, 0.177704, -0.044139], [0.049567, 0.939063, 0.011370], [-0.003453, 0.007233, 0.996220]],
        [[0.760729, 0.319078, -0.079807], [0.090568, 0.889315, 0.020117], [-0.006027, 0.013325, 0.992702]],
        [[0.675425, 0.433850, -0.109275], [0.125303, 0.847755, 0.026942], [-0.007950, 0.018572, 0.989378]],
        [[0.605511, 0.528560, -0.134071], [0.155318, 0.812366, 0.032316], [-0.009376, 0.023176, 0.986200]],
        [[0.547494, 0.607765, -0.155259], [0.181692, 0.781742, 0.036566], [-0.010410, 0.027275, 0.983136]],
        [[0.498864, 0.674741, -0.173604], [0.205199, 0.754872, 0.039929], [-0.011131, 0.030969, 0.980162]],
        [[0.457771, 0.731899, -0.189670], [0.226409, 0.731012, 0.042579], [-0.011595, 0.034333, 0.977261]],
        [[0.422823, 0.781057, -0.203881], [0.245752, 0.709602, 0.044646], [-0.011843, 0.037423, 0.974421]],
        [[0.392952, 0.823610, -0.216562], [0.263559, 0.690210, 0.046232], [-0.011910, 0.040281, 0.971630]],
        [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    ],
    "tritan": [
        [[1.000000, 0.000000, -0.000000], [0.000000, 1.000000, 0.000000], [-0.000000, -0.000000, 1.000000]],
        [[0.926670, 0.092514, -0.019184], [0.021191, 0.964503, 0.014306], [0.008437, 0.054813, 0.936750]],
        [[0.895720, 0.133330, -0.029050], [0.029997, 0.945400, 0.024603], [0.013027, 0.104707, 0.882266]],
        [[0.905871, 0.127791, -0.033662], [0.026856, 0.941251, 0.031893], [0.013410, 0.148296, 0.838294]],
        [[0.948035, 0.089490, -0.037526], [0.014364, 0.946792, 0.038844], [0.010853, 0.193991, 0.795156]],
        [[1.017277, 0.027029, -0.044306], [-0.006113, 0.958479, 0.047634], [0.006379, 0.248708, 0.744913]],
        [[1.104996, -0.046633, -0.058363], [-0.032137, 0.971635, 0.060503], [0.001336, 0.317922, 0.680742]],
        [[1.193214, -0.109812, -0.083402], [-0.058496, 0.979410, 0.079086], [-0.002346, 0.403492, 0.598854]],
        [[1.257728, -0.139648, -0.118081], [-0.078003, 0.975409, 0.102594], [-0.003316, 0.501214, 0.502102]],
        [[1.278864, -0.125333, -0.153531], [-0.084748, 0.957674, 0.127074], [-0.000989, 0.601151, 0.399838]],
        [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
    ],
}


# 달토나이제이션 오차 이동 행렬: 구분되지 않는 색 차이를 사용자가 볼 수 있는 채널로 옮긴다.
# 적색약·녹색약(Fidaner et al. 2005): 빨강 쪽 오차를 초록·파랑 채널로 옮긴다.
# 청색약: 파랑-노랑 정보를 청색약도 구분할 수 있는 빨강-초록 축으로 옮긴다(파랑 오차를 빨강에 +, 초록에 -).
#   같은 크기(0.7)의 후보 3가지를 등록 작품 21점의 '구분이 사라진 색 쌍 복원율'로 비교해 고른 값이다.
ERROR_SHIFT = {
    "protan": np.array([[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]], dtype=np.float32),
    "deutan": np.array([[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]], dtype=np.float32),
    "tritan": np.array([[1, 0, 0.7], [0, 1, -0.7], [0, 0, 0]], dtype=np.float32),
}
JPEG_QUALITY = 92


# sRGB ↔ 선형 RGB 변환 (IEC 61966-2-1). 큰 사진도 빠르게 처리하도록 미리 계산한 표를 쓴다.
_LUT_SIZE = 4096
_GRID = np.linspace(0, 1, _LUT_SIZE, dtype=np.float32)
_TO_LINEAR = np.where(_GRID <= 0.04045, _GRID / 12.92, ((_GRID + 0.055) / 1.055) ** 2.4).astype(np.float32)
_TO_SRGB = np.where(_GRID <= 0.0031308, _GRID * 12.92, 1.055 * np.power(_GRID, 1 / 2.4) - 0.055).astype(np.float32)


def _lookup(values, table):
    index = np.clip(values, 0, 1) * (_LUT_SIZE - 1)
    return table[(index + 0.5).astype(np.int32)]


def srgb_to_linear(rgb):
    return _lookup(rgb, _TO_LINEAR)


def linear_to_srgb(linear):
    return _lookup(linear, _TO_SRGB)


def cvd_matrix(color_type: str, severity: float) -> np.ndarray:
    """정도(0~1)에 맞는 Machado 행렬. 표가 0.1 간격이라 사이 값은 양옆 행렬을 선형 보간한다."""
    table = np.asarray(MACHADO_2009[color_type], dtype=np.float32)
    position = float(np.clip(severity, 0, 1)) * 10
    low = int(np.floor(position))
    high = min(low + 1, 10)
    weight = position - low
    return (1 - weight) * table[low] + weight * table[high]


def simulate(rgb, color_type: str, severity: float):
    """sRGB(0~1) 이미지를 색각이상 사용자에게 보이는 모습으로 바꾼다. (평가·발표용 비교 이미지)"""
    if color_type == "normal" or severity <= 0:
        return rgb
    linear = srgb_to_linear(rgb) @ cvd_matrix(color_type, severity).T
    return linear_to_srgb(linear)


def daltonize(rgb, color_type: str, severity: float):
    if color_type == "normal" or severity <= 0:
        return rgb
    linear = srgb_to_linear(rgb)
    simulated = linear @ cvd_matrix(color_type, severity).T
    error = linear - simulated  # 이 사용자에게 보이지 않는 색 정보
    corrected = linear + error @ ERROR_SHIFT[color_type].T
    return linear_to_srgb(corrected)


def brightness_contrast(rgb, brightness: float, contrast: float):
    if brightness == 0 and contrast == 1:
        return rgb
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)  # float32 입력이면 L* 범위는 0~100
    lab[..., 0] = np.clip((lab[..., 0] - 50) * contrast + 50 + brightness, 0, 100)
    return np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)


def _scale(rgb):
    """사진 크기에 맞춰 흐림·선 굵기를 조절하는 배율 (긴 변 1000px 기준 1)."""
    return max(1.0, max(rgb.shape[:2]) / 1000)


def sharpen(rgb, amount: float):
    if amount <= 0:
        return rgb
    blurred = cv2.GaussianBlur(rgb, (0, 0), sigmaX=1.2 * _scale(rgb))
    return np.clip(rgb + amount * (rgb - blurred), 0, 1)


def emphasize_edges(rgb, edge: float):
    """가는 선을 굵게 + 윤곽선을 진하게. edge(0~1)가 클수록 선이 굵고 진하다.

    1) 가는 선 굵히기: 블랙햇(black-hat) 연산으로 주변보다 어두운 가는 선(판화 선, 빗줄기 등)만 찾고,
       그 선을 팽창시킨 뒤 최소값 필터(침식)로 선 자체의 색을 넓게 칠한다. 선의 원래 색이 유지된다.
    2) 윤곽선 강조: Canny로 형태의 경계를 찾아 진하게 덧그려 저시력 사용자가 형태를 구분하기 쉽게 한다.
    """
    if edge <= 0:
        return rgb
    height, width = rgb.shape[:2]
    # 사진 크기와 관계없이 같은 기준으로 선을 찾도록 긴 변 1000px에서 계산한다.
    ratio = min(1.0, 1000 / max(height, width))
    size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
    gray = cv2.cvtColor((cv2.resize(rgb, size, interpolation=cv2.INTER_AREA) * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    radius = 1 + int(round(2 * edge))  # 굵히는 정도: 긴 변 1000px 기준 약 1~3px씩

    def ellipse(r):
        return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

    def full_size(mask, blur):
        mask = cv2.resize(mask.astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR)
        return cv2.GaussianBlur(mask, (0, 0), sigmaX=blur / ratio)[..., None]

    # 1) 가는 어두운 선 찾기 → 굵히기
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, ellipse(3))
    threshold, _ = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 질감·잡티까지 선으로 잡지 않도록 Otsu 기준보다 조금 높게 자른다.
    lines = (blackhat > max(25, 1.2 * threshold)).astype(np.uint8)
    line_radius = max(1, int(round(1 + 1.5 * edge)))  # 1000px 기준 약 1~2.5px 굵힘
    lines = cv2.dilate(lines, ellipse(line_radius))
    line_mask = full_size(lines, 0.6)
    # 선 색 넓히기도 1000px 크기에서 계산해 원본 크기로 키운다(큰 사진에서 얼룩 모양이 생기지 않게).
    small = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
    line_color = cv2.resize(cv2.erode(small, ellipse(line_radius)), (width, height), interpolation=cv2.INTER_LINEAR)
    weight = line_mask * (0.35 + 0.5 * edge)
    rgb = rgb * (1 - weight) + np.minimum(rgb, line_color) * weight

    # 2) 형태 윤곽선 강조 (Otsu 값을 Canny 높은 기준, 절반을 낮은 기준으로 쓰는 흔한 자동 설정)
    smooth = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.4)
    otsu, _ = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours = cv2.dilate(cv2.Canny(smooth, 0.5 * otsu, otsu), ellipse(max(0, radius - 1)))
    contour_mask = full_size(contours > 0, 0.7) * (0.15 + 0.45 * edge)
    return np.clip(rgb * (1 - contour_mask) + rgb * 0.15 * contour_mask, 0, 1).astype(np.float32)


def correct_array(rgb, profile: dict):
    """sRGB(0~1, float32, H×W×3) 이미지에 프로필 보정을 순서대로 적용한다."""
    rgb = daltonize(rgb, profile.get("color_type", "normal"), float(profile.get("severity", 0)))
    rgb = brightness_contrast(rgb, float(profile.get("brightness", 0)), float(profile.get("contrast", 1)))
    rgb = sharpen(rgb, float(profile.get("sharpness", 0)))
    rgb = emphasize_edges(rgb, float(profile.get("edge", 0)))
    return rgb.astype(np.float32)


def correct_image(content: bytes, profile: dict) -> bytes:
    """서버 계약 함수: RGB JPEG bytes + 프로필 → 같은 크기의 JPEG bytes."""
    with Image.open(BytesIO(content)) as source:
        rgb = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
    corrected = correct_array(rgb, profile)
    output = BytesIO()
    Image.fromarray((corrected * 255 + 0.5).astype(np.uint8)).save(output, format="JPEG", quality=JPEG_QUALITY)
    return output.getvalue()
