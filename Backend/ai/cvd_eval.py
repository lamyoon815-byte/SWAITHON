"""색각이상 보정 '평가' 전용 시뮬레이터 (서비스 보정에는 쓰지 않는다).

보정은 Machado(2009) 모델로 하므로, 같은 모델로 결과를 재면 자기 채점이 되어 수치가 부풀어 오른다.
그래서 평가는 다른 모델로 한다: 적색약·녹색약은 Viénot, Brettel & Mollon(1999), 청색약은 Brettel, Viénot & Mollon(1997).
값은 libDaltonLens(퍼블릭 도메인, https://github.com/DaltonLens/libDaltonLens)의 sRGB용 미리 계산된 행렬을 그대로 옮겼다.
모두 선형 RGB 기준이며 세기(severity)는 원본과 선형 보간한다(libDaltonLens와 같다).
"""
import numpy as np

if __package__ and "." in __package__:
    from .correction import linear_to_srgb, srgb_to_linear
else:
    from correction import linear_to_srgb, srgb_to_linear

VIENOT_1999 = {
    "protan": np.array([[0.11238, 0.88762, 0.0], [0.11238, 0.88762, 0.0], [0.00401, -0.00401, 1.0]], dtype=np.float32),
    "deutan": np.array([[0.29275, 0.70725, 0.0], [0.29275, 0.70725, 0.0], [-0.02234, 0.02234, 1.0]], dtype=np.float32),
}
# 청색약은 Viénot 1999가 부정확해 Brettel 1997의 두 반평면 투영을 쓴다.
BRETTEL_1997_TRITAN = {
    "plane1": np.array([[1.01277, 0.13548, -0.14826], [-0.01243, 0.86812, 0.14431], [0.07589, 0.80500, 0.11911]], dtype=np.float32),
    "plane2": np.array([[0.93678, 0.18979, -0.12657], [0.06154, 0.81526, 0.12320], [-0.37562, 1.12767, 0.24796]], dtype=np.float32),
    "normal": np.array([0.03901, -0.02788, -0.01113], dtype=np.float32),
}


def simulate_independent(rgb, color_type: str, severity: float = 1.0):
    """sRGB(0~1) 이미지를 독립 모델로 색각이상 시뮬레이션한다."""
    linear = srgb_to_linear(np.clip(rgb, 0, 1))
    if color_type == "tritan":
        params = BRETTEL_1997_TRITAN
        first = (linear @ params["normal"]) >= 0
        seen = np.where(first[..., None], linear @ params["plane1"].T, linear @ params["plane2"].T)
    else:
        seen = linear @ VIENOT_1999[color_type].T
    seen = seen * severity + linear * (1 - severity)
    return linear_to_srgb(np.clip(seen, 0, 1))


def mean_delta_e(before, after):
    """원본 대비 평균 색 변화 (CIELAB ΔE76)."""
    import cv2
    lab = lambda x: cv2.cvtColor(np.clip(x, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)
    return float(np.linalg.norm(lab(after) - lab(before), axis=-1).mean())


def boundary_recovery(original, corrected, color_type: str, severity: float = 1.0, pairs: int = 40000, seed: int = 0):
    """색 경계 구분도 (독립 모델 기준).

    가까운 픽셀 쌍(최대 4px 떨어짐)을 무작위로 뽑아, 정상 시각의 색 차이(ΔE)를 100%로 놓고 색각이상 시각에서
    몇 %가 보이는지 쌍마다 계산해 100%에서 자른 뒤 평균한다. 정상 시각에서 ΔE 10 이상이면서 색각이상 시각에서
    절반 아래로 줄어드는 '헷갈리는 쌍'만 센다. 반환: (헷갈리는 쌍 비율, 보정 전 구분도, 보정 후 구분도)
    """
    import cv2
    lab = lambda x: cv2.cvtColor(np.clip(x, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)
    rng = np.random.default_rng(seed)
    height, width = original.shape[:2]
    ys, xs = rng.integers(0, height, pairs), rng.integers(0, width, pairs)
    y2 = np.clip(ys + rng.integers(-4, 5, pairs), 0, height - 1)
    x2 = np.clip(xs + rng.integers(-4, 5, pairs), 0, width - 1)
    difference = lambda image: np.linalg.norm(image[ys, xs] - image[y2, x2], axis=1)
    normal = difference(lab(original))
    before = difference(lab(simulate_independent(original, color_type, severity)))
    after = difference(lab(simulate_independent(corrected, color_type, severity)))
    confusing = (normal >= 10) & (before < 0.5 * normal)
    if not confusing.any():
        return 0.0, 1.0, 1.0
    seen = lambda value: float(np.mean(np.minimum(value[confusing] / normal[confusing], 1.0)))
    return float(confusing.mean()), seen(before), seen(after)
