"""색각 보정·밝기/대비·선명도·선 굵기 보정 함수(Backend/ai/correction.py) 테스트."""
from io import BytesIO
import unittest

import cv2
import numpy as np
from PIL import Image

from Backend.ai.correction import MACHADO_2009, correct_array, correct_image, cvd_matrix, simulate
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
            before = lab_distance(simulate(self.red_green, color_type, 1.0), (30, 10), (30, 70))
            corrected = correct_array(self.red_green, {"color_type": color_type, "severity": 1.0})
            after = lab_distance(simulate(corrected, color_type, 1.0), (30, 10), (30, 70))
            self.assertGreater(after, before * 1.3, color_type)

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


if __name__ == "__main__":
    unittest.main()
