"""Actual-pixel derivatives, fallback and budget guarantees for correction v2."""
from dataclasses import replace
import unittest

import numpy as np

from Backend.ai.correction import correct_array, cvd_matrix
from Backend.ai.palette_correction import decode_srgb, mean_change
from Backend.ai.pixel_correction import (PixelConfig, correct_pixels, memberships,
                                         apply_residual, lookup_lut, pair_data, passes, pixel_objective, quality)


FAST = replace(PixelConfig(), training_pixels=128, validation_pixels=128,
               candidate_pairs=2000, fitted_pairs=128, iterations=16, check_every=4)


class PixelCorrectionTests(unittest.TestCase):
    def test_full_image_lut_application_matches_constant_linear_residual(self):
        from Backend.ai.palette_correction import encode_srgb
        original = np.random.default_rng(28).uniform(.2, .7, (12, 14, 3)).astype(np.float32)
        baseline_linear = decode_srgb((original * .95).reshape(-1, 3).astype(float))
        basis = np.ones((3, 3, 3, 1))
        parameters = np.array([[.001, -.002, .003]])
        output = apply_residual(original, baseline_linear, basis, parameters, FAST)
        other = apply_residual(original, baseline_linear, basis, parameters, replace(FAST, chunk_pixels=7))
        expected = encode_srgb(baseline_linear + parameters).reshape(original.shape)
        np.testing.assert_allclose(output, expected, atol=1e-7)
        np.testing.assert_array_equal(output, other)

    def test_lut_is_exact_for_linear_fields_and_includes_endpoints(self):
        coordinates = np.stack(np.meshgrid(*([np.linspace(0, 1, 7)] * 3), indexing="ij"), axis=-1)
        cube = coordinates @ np.array([[1, 2], [3, 4], [5, 6]]) + [7, 8]
        points = np.vstack([np.random.default_rng(18).random((100, 3)), [0, 0, 0], [1, 1, 1]])
        expected = points @ np.array([[1, 2], [3, 4], [5, 6]]) + [7, 8]
        np.testing.assert_allclose(lookup_lut(points, cube), expected, atol=1e-12)

    def test_gradient_through_real_pixels_and_soft_weights(self):
        original = decode_srgb(np.array([[0.75, 0.25, 0.2], [0.35, 0.55, 0.2],
                                         [0.2, 0.3, 0.7], [0.6, 0.5, 0.1]]))
        baseline = original + np.array([[0, 0, .02], [0, .01, .005], [.01, 0, 0], [0, 0, .01]])
        weights = memberships(original, original, 25)
        matrix = cvd_matrix("deutan", 1).astype(float)
        data = pair_data(original, baseline, matrix, np.random.default_rng(4), 200)
        self.assertTrue(data["lost"].any())
        self.assertTrue(data["safe"].any())
        objective = pixel_objective(original, baseline, weights, matrix, data, FAST)
        parameters = np.full((4, 3), 0.0007)
        _, analytic = objective(parameters)
        numerical = np.empty_like(parameters)
        for row in range(4):
            for col in range(3):
                plus, minus = parameters.copy(), parameters.copy()
                plus[row, col] += 1e-7
                minus[row, col] -= 1e-7
                numerical[row, col] = (objective(plus)[0] - objective(minus)[0]) / 2e-7
        np.testing.assert_allclose(analytic, numerical, atol=1e-4, rtol=1e-4)

    def test_selector_requires_real_gain_and_no_new_collision_increase(self):
        base = {"lost_pairs": 100, "recovered": 50, "new_collisions": 4}
        self.assertTrue(passes({**base, "recovered": 51}, base))
        self.assertFalse(passes(base, base))
        self.assertFalse(passes({**base, "recovered": 49}, base))
        self.assertFalse(passes({**base, "recovered": 51, "new_collisions": 5}, base))
        self.assertFalse(passes({**base, "lost_pairs": 10, "recovered": 51}, base))

    def test_full_pipeline_budget_reproducibility_and_exact_fallback(self):
        image = np.random.default_rng(55).uniform(.12, .8, (20, 30, 3)).astype(np.float32)
        before = image.copy()
        baseline = correct_array(image, {"color_type": "deutan", "severity": 1})
        first, info = correct_pixels(image, "deutan", baseline=baseline, config=FAST)
        second, second_info = correct_pixels(image, "deutan", baseline=baseline, config=FAST)
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(image, before)
        self.assertEqual(info, second_info)
        self.assertEqual(first.dtype, np.float32)
        self.assertTrue(np.isfinite(first).all())
        self.assertGreaterEqual(float(first.min()), 0)
        self.assertLessEqual(float(first.max()), 1)
        self.assertLessEqual(mean_change(image, first), mean_change(image, baseline) + 1e-6)
        if info["selected"]:
            self.assertTrue(passes(info["final_validation"], info["baseline_validation"]))
        else:
            np.testing.assert_array_equal(first, baseline)

    def test_normal_zero_strength_and_no_budget(self):
        image = np.full((15, 20, 3), [.75, .25, .2], np.float32)
        np.testing.assert_array_equal(correct_pixels(image, "normal")[0], image)
        np.testing.assert_array_equal(correct_pixels(image, "deutan", 0)[0], image)
        actual, info = correct_pixels(image, "deutan", baseline=image, config=FAST)
        np.testing.assert_array_equal(actual, image)
        self.assertFalse(info["selected"])

    def test_invalid_contracts(self):
        image = np.full((3, 4, 3), .4, np.float32)
        for value in (np.full((2, 2, 3), np.nan), np.ones((3, 3)), np.zeros((0, 2, 3))):
            with self.assertRaises(ValueError):
                correct_pixels(value, "deutan")
        for kwargs in ({"strength": -1}, {"strength": np.nan}, {"baseline": np.zeros((2, 2, 3))}):
            with self.assertRaises(ValueError):
                correct_pixels(image, "deutan", **kwargs)
        with self.assertRaises(ValueError):
            PixelConfig(sigma=0)
        with self.assertRaises(ValueError):
            PixelConfig(iterations=1.5)


class FastEvaluationTests(unittest.TestCase):
    def test_sampled_rgb_evaluation_matches_whole_image_evaluation(self):
        from Backend.ai.palette_correction import image_lab
        from Backend.ai.palette_evaluation import MODELS, TYPES, pair_metrics, simulate_held_out
        from Backend.ai.pixel_experiment import PAIR_SEED, fast_artwork_metrics
        image = np.random.default_rng(44).uniform(.02, .98, (23, 31, 3)).astype(np.float32)
        baseline, candidate = image * .9, image * np.array([.9, .8, 1], np.float32)
        count = 2000
        indices = np.random.default_rng(PAIR_SEED).integers(0, 23*31, (count, 2))
        normal = image_lab(image)
        for color in TYPES:
            actual = {row["model"]: row for row in fast_artwork_metrics(image, baseline, candidate, color, count)}
            for model in MODELS:
                before = image_lab(simulate_held_out(image, model, color))
                for name, corrected in (("baseline", baseline), ("candidate", candidate)):
                    seen = image_lab(simulate_held_out(corrected, model, color))
                    expected = pair_metrics(normal, before, seen, indices)
                    self.assertEqual(actual[model][name], expected)

    def test_sampled_dot_contrast_matches_whole_image_contrast(self):
        from Backend.ai.palette_evaluation import MODELS, TYPES, simulate_held_out
        from Backend.ai.pixel_experiment import fast_number_contrast
        from Backend.ai.plates import number_contrast
        image = np.random.default_rng(44).uniform(.02, .98, (23, 31, 3)).astype(np.float32)
        dots = [(1, 2, True), (20, 10, True), (5, 8, False), (15, 16, False), (29, 21, False)]
        for color in TYPES:
            for model in MODELS:
                expected = number_contrast(simulate_held_out(image, model, color), dots)
                self.assertAlmostEqual(fast_number_contrast(image, dots, model, color), expected, places=5)


if __name__ == "__main__":
    unittest.main()
