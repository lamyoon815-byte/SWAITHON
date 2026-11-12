"""Require exact original distances, masks and outputs for faster A' execution."""
import unittest

import numpy as np

from Backend.ai.correction import _color_weight, _confusion_lab, correct_array
from Backend.ai.fast_correction_baseline import color_weight, correct_pixels_fast, fast_baseline, pair_distances


class FastBaselineTests(unittest.TestCase):
    def test_v2_wrapper_matches_the_original_pipeline(self):
        from dataclasses import replace
        from Backend.ai.pixel_correction import PixelConfig, correct_pixels
        config = replace(PixelConfig(), training_pixels=128, validation_pixels=128,
                         candidate_pairs=2000, fitted_pairs=128, iterations=16, check_every=4)
        image = np.random.default_rng(29).uniform(.1, .8, (29, 31, 3)).astype(np.float32)
        expected, info = correct_pixels(image, "deutan", config=config)
        actual, actual_info = correct_pixels_fast(image, "deutan", config=config)
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(actual_info, info)

    def test_distance_operation_order_is_bit_identical(self):
        rng = np.random.default_rng(16)
        for dtype in (np.float32, np.float64):
            first = rng.uniform(-128, 128, (47, 3)).astype(dtype)
            second = rng.uniform(-128, 128, (73, 3)).astype(dtype)
            expected = np.linalg.norm(first[:, None] - second[None], axis=2)
            np.testing.assert_array_equal(pair_distances(first, second), expected)

    def test_color_masks_are_identical_across_block_sizes(self):
        image = np.random.default_rng(18).uniform(.1, .8, (29, 31, 3)).astype(np.float32)
        for color in ("protan", "deutan"):
            normal, _ = _confusion_lab(image, color)
            np.testing.assert_array_equal(color_weight(image, color, normal), _color_weight(image, color, normal))

    def test_single_type_output_matches_current_algorithm_exactly(self):
        image = np.random.default_rng(29).uniform(.1, .8, (29, 31, 3)).astype(np.float32)
        for color in ("normal", "protan", "deutan", "tritan"):
            for strength in (0, .2, .6, 1):
                expected = correct_array(image, {"color_type": color, "severity": strength})
                np.testing.assert_array_equal(fast_baseline(image, color, strength), expected)


if __name__ == "__main__":
    unittest.main()
