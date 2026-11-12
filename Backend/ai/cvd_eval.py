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


def boundary_recovery(original, corrected, color_type: str, severity: float = 1.0):
    """색 경계 구분도 (독립 모델 기준, 정윤의 round2.py와 같은 정의).

    가로·세로로 이웃한 모든 픽셀 쌍 중 정상 시각에서 ΔE 5 이상인데 독립 모델 시뮬레이션에서 60% 미만으로 줄어드는
    '헷갈리는 경계'만 골라, 정상 시각 차이를 100%로 놓고 보정 뒤 색각이상 시각에서 몇 %가 보이는지 쌍마다 구해
    100%에서 자른 뒤 평균한다(넘치면 과보정이라 자른다). 측정은 그림을 긴 변 600px로 줄여서 한다.
    반환: (헷갈리는 경계 비율, 보정 전 구분도, 보정 후 구분도)
    """
    import cv2
    lab = lambda x: cv2.cvtColor(np.clip(x, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)

    def neighbours(image):
        values = lab(image)
        return (np.linalg.norm(values[:, 1:] - values[:, :-1], axis=2),
                np.linalg.norm(values[1:] - values[:-1], axis=2))

    normal = neighbours(original)
    before = neighbours(simulate_independent(original, color_type, severity))
    after = neighbours(simulate_independent(corrected, color_type, severity))
    lost = [(n >= 5) & (b < 0.6 * n) for n, b in zip(normal, before)]
    count = sum(int(m.sum()) for m in lost)
    total = sum(m.size for m in lost)
    if count == 0:
        return 0.0, 1.0, 1.0
    seen = lambda pairs: float(np.mean(np.minimum(np.concatenate([p[m] / n[m] for p, n, m in zip(pairs, normal, lost)]), 1.0)))
    return count / total, seen(before), seen(after)


def pair_recovery(original, corrected, color_type: str, pairs: int = 30000, seed: int = 0):
    """떨어진 색까지 포함한 구분 회복률: 무작위 픽셀 쌍 기준 (correction_demo.py와 같은 정의, 독립 모델).

    정상 시각에서 확실히 다른 색(ΔE > 15)인데 독립 모델 시뮬레이션에서 차이가 절반 미만인 쌍 중,
    보정 후 차이가 정상의 절반 이상으로 돌아온 비율. (구분이 사라진 쌍 비율, 회복률)을 반환한다.
    boundary_recovery는 붙은 픽셀만 보므로, 서로 떨어진 빨강·초록 같은 경우는 이 함수로 잰다.
    """
    import cv2
    flat = lambda image: cv2.cvtColor(np.clip(image, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB).reshape(-1, 3)
    index = np.random.default_rng(seed).integers(0, original.shape[0] * original.shape[1], size=(pairs, 2))
    distance = lambda image: np.linalg.norm(flat(image)[index[:, 0]] - flat(image)[index[:, 1]], axis=1)
    normal = distance(original)
    lost = (normal > 15) & (distance(simulate_independent(original, color_type)) < 0.5 * normal)
    if not lost.any():
        return 0.0, float("nan")
    back = distance(simulate_independent(corrected, color_type)) >= 0.5 * normal
    return float(lost.mean()), float((back & lost).sum() / lost.sum())

