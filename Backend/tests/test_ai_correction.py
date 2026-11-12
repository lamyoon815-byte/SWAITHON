"""색각 보정·밝기/대비·선명도·선 굵기 보정 함수(Backend/ai/correction.py) 테스트."""
from io import BytesIO
import json
from pathlib import Path
import unittest

import cv2
import numpy as np
from PIL import Image

from Backend.ai.correction import (ERROR_SHIFT, LUMA, MACHADO_2009, apply_contrast, confusion_weight, correct_array, correct_image,
                                   cvd_matrix, daltonize, emphasize_edges, linear_to_srgb, simulate, srgb_to_linear, tone_curve, tone_mid)
from Backend.ai.profile import AIProfile


def jpeg(array):
    stream = BytesIO()
    Image.fromarray((array * 255).astype(np.uint8)).save(stream, format="JPEG", quality=95)
    return stream.getvalue()


def lab_distance(rgb, a, b):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    return float(np.linalg.norm(lab[a] - lab[b]))


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        # 왼쪽 빨강, 오른쪽 초록: 적록 색각이상에게 비슷하게 보이는 색 쌍
        self.red_green = np.zeros((60, 80, 3), dtype=np.float32)
        self.red_green[:, :40] = (0.75, 0.25, 0.2)
        self.red_green[:, 40:] = (0.35, 0.55, 0.2)

    def test_matrix_table_and_interpolation(self):
        for color_type in ("protan", "deutan", "tritan"):
            self.assertEqual(len(MACHADO_2009[color_type]), 11)
            np.testing.assert_allclose(cvd_matrix(color_type, 0), np.eye(3), atol=1e-6)
        np.testing.assert_allclose(cvd_matrix("protan", 1.0)[0], [0.152286, 1.052583, -0.204868], atol=1e-6)
        middle = (np.array(MACHADO_2009["deutan"][4]) + np.array(MACHADO_2009["deutan"][5])) / 2
        np.testing.assert_allclose(cvd_matrix("deutan", 0.45), middle, atol=1e-5)

    def test_daltonize_restores_red_green_difference(self):
        for color_type in ("protan", "deutan"):
            # 그림 전체 보정: 떨어진 두 점도 구분이 커진다
            before = lab_distance(simulate(self.red_green, color_type, 1.0), (30, 10), (30, 70))
            full = daltonize(self.red_green, color_type, 1.0)
            self.assertGreater(lab_distance(simulate(full, color_type, 1.0), (30, 10), (30, 70)), before * 1.3, color_type)
            # 서버 보정(헷갈리는 곳만): 빨강·초록이 서로 짝이 되므로 떨어진 두 점도 그림 전체 보정과 똑같이 보정된다
            corrected = correct_array(self.red_green, {"color_type": color_type, "severity": 1.0})
            np.testing.assert_allclose(corrected[:, :30], full[:, :30], atol=1e-3)
            np.testing.assert_allclose(corrected[:, 50:], full[:, 50:], atol=1e-3)

    def test_color_without_a_confusing_partner_is_left_alone(self):
        # 빨강만 있는 그림: 헷갈릴 짝 색이 없으므로 원본 그대로 (그림 전체 보정은 색을 바꾼다)
        red = np.zeros((40, 60, 3), dtype=np.float32)
        red[:] = (0.75, 0.25, 0.2)
        for color_type in ("protan", "deutan"):
            self.assertGreater(float(np.abs(daltonize(red, color_type, 1.0) - red).max()), 0.05)
            np.testing.assert_allclose(correct_array(red, {"color_type": color_type, "severity": 1.0}), red, atol=1e-3)

    def test_all_active_types_are_applied_in_fixed_order_and_zero_is_an_identity(self):
        rgb = np.random.default_rng(42).uniform(0.15, 0.65, (12, 15, 3)).astype(np.float32)
        colors = {"protan": 0.4, "deutan": 0.6, "tritan": 0.8}
        selective = lambda image, color, level: daltonize(image, color, level, confusion_weight(image, color))
        expected = daltonize(selective(selective(rgb, "protan", 0.4), "deutan", 0.6), "tritan", 0.8)
        for selected in colors:
            actual = correct_array(rgb, {"color_type": selected, "severity": colors[selected], "color_severities": dict(reversed(list(colors.items())))})
            np.testing.assert_array_equal(actual, expected)
        for disabled in colors:
            levels = {**colors, disabled: 0}
            actual = correct_array(rgb, {"color_type": disabled, "severity": 0, "color_severities": levels})
            self.assertGreater(float(np.abs(actual - expected).mean()), 0.001)
        np.testing.assert_array_equal(correct_array(rgb, {"color_type": "tritan", "color_severities": {}}), rgb)
        np.testing.assert_array_equal(correct_array(rgb, {"color_type": "normal", "color_severities": colors}), rgb)
        np.testing.assert_array_equal(correct_array(rgb, {"color_type": "deutan", "color_severities": {"protan": 0, "deutan": 0.6, "tritan": 0}}), selective(rgb, "deutan", 0.6))

    def test_preview_matrices_match_the_existing_server_algorithm(self):
        tables = json.loads((Path(__file__).resolve().parents[2] / "Frontend/src/lib/color-correction-matrices.json").read_text())
        for color, matrices in tables.items():
            for index, matrix in enumerate(matrices):
                expected = np.eye(3) + ERROR_SHIFT[color] @ (np.eye(3) - cvd_matrix(color, index / 10))
                np.testing.assert_allclose(np.array(matrix).reshape(3, 3), expected, atol=1e-7)

    def test_default_profile_keeps_image_and_contract(self):
        content = jpeg(self.red_green)
        defaults = AIProfile().model_dump()
        output = correct_image(content, defaults)
        with Image.open(BytesIO(output)) as result, Image.open(BytesIO(content)) as source:
            self.assertEqual((result.format, result.size), ("JPEG", source.size))
            difference = np.abs(np.asarray(result, dtype=float) - np.asarray(source, dtype=float)).mean()
        self.assertLess(difference, 2.0)  # 기본값이면 JPEG 재압축 수준의 차이만 있다.
        full = {"color_type": "tritan", "severity": 0.7, "contrast": 1.5, "brightness": -20, "sharpness": 1.5, "edge": 1.0}
        with Image.open(BytesIO(correct_image(content, AIProfile(**full).model_dump()))) as result:
            self.assertEqual(result.size, (80, 60))

    def test_brightness_and_contrast_on_lightness(self):
        gray = np.full((20, 20, 3), 0.5, dtype=np.float32)
        self.assertGreater(correct_array(gray, {"brightness": 30}).mean(), 0.6)
        ramp = np.repeat(np.linspace(0.2, 0.8, 20, dtype=np.float32)[None, :, None], 3, axis=2).repeat(20, axis=0)
        self.assertGreater(correct_array(ramp, {"contrast": 1.8}).std(), ramp.std())

    def test_edge_thickens_thin_dark_line(self):
        image = np.full((200, 200, 3), 0.9, dtype=np.float32)
        image[:, 99:101] = 0.1  # 폭 2px의 가는 세로선
        dark_before = int((image[..., 0] < 0.5).sum())
        dark_after = int((correct_array(image, {"edge": 1.0})[..., 0] < 0.5).sum())
        self.assertGreater(dark_after, dark_before * 1.5)

    def test_small_edge_settings_do_not_have_a_fixed_large_effect(self):
        image = np.full((200, 200, 3), 0.9, dtype=np.float32)
        image[:, 99:101] = 0.1
        differences = [float(np.abs(correct_array(image, {"edge": edge}) - image).mean())
                       for edge in (0, 0.001, 0.01, 0.2, 0.4, 0.6, 0.8, 1)]
        self.assertEqual(differences[0], 0)
        self.assertLess(differences[1], differences[-1] * 0.003)
        self.assertLess(differences[2], differences[-1] * 0.03)
        self.assertEqual(differences, sorted(differences))



def dark_painting(seed=7):
    """어두운 유화처럼: 대부분 밝기 0.03~0.3인 바탕에 밝은 인물(0.6~0.8) 하나와 어두운 사물 몇 개."""
    rng = np.random.default_rng(seed)
    y = np.clip(0.12 + 0.05 * rng.standard_normal((240, 240)), 0.02, 0.3).astype(np.float32)
    y = cv2.GaussianBlur(y, (0, 0), 3)
    cv2.circle(y, (150, 110), 40, 0.7, -1)
    cv2.rectangle(y, (30, 160), (90, 220), 0.05, -1)
    cv2.rectangle(y, (40, 40), (80, 100), 0.22, -1)
    return np.stack([y * 1.1, y, y * 0.8], axis=-1).clip(0, 1).astype(np.float32)


class DarkImageTests(unittest.TestCase):
    """어두운 그림이 대비·윤곽 보정 뒤 검게 뭉개지는(호러처럼 보이는) 문제 회귀 테스트."""

    def setUp(self):
        self.image = dark_painting()
        self.luma = self.image @ LUMA

    def test_tone_curve_keeps_black_and_white(self):
        for contrast in (0.5, 0.8, 1.4, 2.0):
            for mid in (0.2, 0.5, 0.7):
                ends = tone_curve(np.array([0.0, 1.0], np.float32), contrast, mid)
                np.testing.assert_allclose(ends, [0, 1], atol=1e-4)
                values = tone_curve(np.linspace(0, 1, 101, dtype=np.float32), contrast, mid)
                self.assertTrue(np.all(np.diff(values) >= -1e-6))  # 밝기 순서가 뒤집히지 않는다

    def test_contrast_keeps_mean_and_does_not_crush_shadows(self):
        for contrast in (1.4, 2.0):
            out = apply_contrast(self.image, contrast) @ LUMA
            self.assertAlmostEqual(float(out.mean()), float(self.luma.mean()), delta=0.01)
            self.assertGreater(float(out.std()), float(self.luma.std()))  # 대비는 실제로 커진다
            # 예전 방식(0.5 기준 직선)은 이 그림의 63% 이상을 거의 검정(0.02 미만)으로 만들었다.
            self.assertLess(float((out < 0.02).mean()), 0.05)
            old = np.clip(self.luma * contrast + 0.5 * (1 - contrast), 0, 1)
            self.assertGreater(float((old < 0.02).mean()), 0.6)

    def test_mid_follows_picture_brightness(self):
        dark, _ = np.histogram(self.luma, bins=32, range=(0, 1))
        bright, _ = np.histogram(1 - self.luma, bins=32, range=(0, 1))
        self.assertLess(tone_mid(dark, 1.6), 0.5)
        self.assertGreater(tone_mid(bright, 1.6), 0.5)

    def test_edges_keep_mean_brightness_on_dark_painting(self):
        for edge in (0.4, 1.0):
            out = emphasize_edges(self.image, edge) @ LUMA
            self.assertAlmostEqual(float(out.mean()), float(self.luma.mean()), delta=0.01)
            self.assertLess(float((out < 0.02).mean()), float((self.luma < 0.02).mean()) + 0.02)
            # 어두운 곳은 원래 밝기의 절반보다 어두워지지 않는다.
            self.assertTrue(np.all(out >= self.luma * 0.5 - 0.01))

    def test_bipolar_edge_brightens_bright_side_and_darkens_dark_side(self):
        image = np.full((120, 120, 3), 0.2, dtype=np.float32)
        image[:, 60:] = 0.6
        out = emphasize_edges(image, 1.0)
        self.assertGreater(float(out[60, 62, 0]), 0.6 + 0.02)   # 밝은 쪽은 더 밝게
        self.assertLess(float(out[60, 57, 0]), 0.2 - 0.02)      # 어두운 쪽은 더 어둡게
        self.assertAlmostEqual(float(out[60, 5, 0]), 0.2, delta=1e-3)    # 경계에서 먼 곳은 그대로
        self.assertAlmostEqual(float(out[60, 115, 0]), 0.6, delta=1e-3)



class TritanMatrixTests(unittest.TestCase):
    """청색약 오차 이동 행렬: 원뿔 공간에서 유도한 값인지, 예전 행렬보다 색을 덜 바꾸는지 (독립 모델로 평가)."""

    def test_matrix_is_lms_derivation(self):
        from Backend.ai.correction import LMS_FROM_LINEAR_RGB, TRITAN_GAIN, tritan_error_shift
        shift = ERROR_SHIFT["tritan"]
        np.testing.assert_allclose(shift, tritan_error_shift(TRITAN_GAIN), atol=1e-6)
        self.assertEqual(np.linalg.matrix_rank(shift.astype(np.float64), tol=1e-6), 1)  # 오차의 S 성분 하나에만 반응
        # 열 방향 = LMS 행렬의 S 행 (S 원뿔 성분만 옮긴다)
        s_row = LMS_FROM_LINEAR_RGB[2] / LMS_FROM_LINEAR_RGB[2, 0]
        np.testing.assert_allclose(shift[0] / shift[0, 0], s_row, rtol=1e-3)
        # 옮긴 결과는 S를 바꾸지 않는다 (원뿔 대비 기준 L−M 축으로만 이동)
        moved = LMS_FROM_LINEAR_RGB @ shift.astype(np.float64) @ np.array([0.1, -0.2, 0.3])
        self.assertAlmostEqual(float(moved[2]), 0.0, places=6)
        white = LMS_FROM_LINEAR_RGB @ np.ones(3)
        self.assertAlmostEqual(float(moved[0] / white[0] + moved[1] / white[1]), 0.0, places=6)
        np.testing.assert_allclose(np.round(shift, 4), [[0.0262, 0.1612, 1.2830], [-0.0068, -0.0417, -0.3317], [0.0003, 0.0019, 0.0155]], atol=1e-4)

    def test_independent_simulators(self):
        from Backend.ai.cvd_eval import simulate_independent
        gray = np.full((4, 4, 3), 0.5, dtype=np.float32)
        image = np.random.default_rng(3).random((8, 8, 3)).astype(np.float32)
        for color in ("protan", "deutan", "tritan"):
            np.testing.assert_allclose(simulate_independent(gray, color), gray, atol=0.01)  # 무채색은 그대로
            np.testing.assert_allclose(simulate_independent(image, color, 0.0), image, atol=0.002)

    def test_new_matrix_changes_colors_less_and_still_helps(self):
        from Backend.ai.cvd_eval import boundary_recovery, mean_delta_e
        old = np.array([[1, 0, 0.7], [0, 1, -0.7], [0, 0, 0]], dtype=np.float32)
        root = Path(__file__).resolve().parents[1] / "data" / "artworks"
        for stem in ("aic_water-lilies", "aic_the-bedroom"):
            with Image.open(root / f"{stem}.jpg") as image:
                image = image.convert("RGB")
                image.thumbnail((400, 400))
                rgb = np.asarray(image, dtype=np.float32) / 255
            linear = srgb_to_linear(rgb)
            error = linear - linear @ cvd_matrix("tritan", 1.0).T
            before = linear_to_srgb(linear + error @ old.T)
            after = daltonize(rgb, "tritan", 1.0)
            self.assertLess(mean_delta_e(rgb, after), 0.7 * mean_delta_e(rgb, before), stem)
            if stem == "aic_water-lilies":  # 헷갈리는 경계가 많은 그림(10%)에서는 구분이 크게 늘어난다
                _, untouched, corrected = boundary_recovery(rgb, after, "tritan")
                self.assertGreater(corrected, untouched + 0.3, stem)
            # 침실처럼 헷갈리는 경계가 적은 그림(약 5%)은 새 행렬의 이득이 거의 없다(정윤 측정과 같음). 그래서 검사하지 않는다.



class SelectiveCorrectionTests(unittest.TestCase):
    """적색약·녹색약 '헷갈리는 곳만 보정': 독립 모델(Viénot 1999)로 효과는 거의 지키고 색 변화는 줄이는지."""

    @staticmethod
    def artwork(stem):
        with Image.open(Path(__file__).resolve().parents[1] / "data" / "artworks" / f"{stem}.jpg") as image:
            image = image.convert("RGB")
            image.thumbnail((600, 600))
            return np.asarray(image, dtype=np.float32) / 255

    def test_keeps_most_benefit_with_less_color_change(self):
        from Backend.ai.cvd_eval import mean_delta_e, pair_recovery
        for stem in ("aic_the-bedroom", "nga_woman-with-a-parasol"):
            rgb = self.artwork(stem)
            for color in ("protan", "deutan"):
                full = daltonize(rgb, color, 1.0)
                selective = correct_array(rgb, {"color_type": color, "color_severities": {color: 1.0}})
                _, untouched = pair_recovery(rgb, rgb, color)
                _, full_seen = pair_recovery(rgb, full, color)
                _, selective_seen = pair_recovery(rgb, selective, color)
                # 떨어진 색 쌍 기준 효과의 90% 이상 유지, 색 변화는 0.85배 미만
                self.assertGreater(selective_seen - untouched, 0.9 * (full_seen - untouched), (stem, color))
                self.assertLess(mean_delta_e(rgb, selective), 0.85 * mean_delta_e(rgb, full), (stem, color))

    def test_plates_match_whole_picture_correction(self):
        """검사판(숫자·바탕 두 색)은 두 색이 서로 짝이라 그림 전체 보정과 같다. 그래서 기존 검사판을 그대로 쓴다."""
        from Backend.ai.calibration_assets import PLATE_NUMBERS, PLATE_SEED
        from Backend.ai.plates import make_plate, number_contrast
        for color in ("protan", "deutan"):
            plate, dots = make_plate(color, PLATE_NUMBERS[color][0], PLATE_SEED[color])
            for level in (0.2, 0.6, 1.0):
                full = number_contrast(simulate(daltonize(plate, color, level), color, 1.0), dots)
                selective = number_contrast(simulate(correct_array(plate, {"color_type": color, "severity": level}), color, 1.0), dots)
                self.assertAlmostEqual(selective, full, delta=0.5, msg=(color, level))


if __name__ == "__main__":
    unittest.main()
