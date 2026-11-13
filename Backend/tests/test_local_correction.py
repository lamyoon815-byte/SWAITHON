"""Numerical checks for the local bound, derivatives and final-image contract."""
from dataclasses import replace
import unittest

import numpy as np

from Backend.ai.correction import correct_array, cvd_matrix
from Backend.ai.local_correction import (LocalConfig, continuous_lab, correct_local,
                                         efficient_baseline, guard_local, lab_to_linear,
                                         local_objective, lookup, project_lab, apply_local)
from Backend.ai.palette_correction import decode_srgb, encode_srgb, image_lab, linear_lab
from Backend.ai.pixel_correction import memberships, pair_data, lookup_lut
from Backend.ai import local_native


FAST = replace(LocalConfig(), training_pixels=128, validation_pixels=128,
               candidate_pairs=2000, fitted_pairs=128, iterations=16, check_every=4)


class LocalCorrectionTests(unittest.TestCase):
    def test_preflight_guard_matches_full_image_pixels(self):
        rng = np.random.default_rng(687)
        image = rng.uniform(.05, .95, (41, 70, 3)).astype(np.float32)
        baseline = np.clip(image + rng.normal(0, .04, image.shape), 0, 1).astype(np.float32)
        basis = rng.random((7, 7, 7, 3))
        basis /= basis.sum(axis=-1, keepdims=True)
        parameters = rng.normal(0, 8, (3, 3))
        candidate = apply_local(image, baseline, basis, parameters, FAST)
        full, _ = guard_local(image, baseline, candidate)
        positions = rng.choice(image.shape[0] * image.shape[1], 937, replace=False)
        sample_image = image.reshape(-1, 3)[positions][None]
        sample_base = baseline.reshape(-1, 3)[positions][None]
        sample_candidate = apply_local(sample_image, sample_base, basis, parameters, FAST)
        preflight, _ = guard_local(sample_image, sample_base, sample_candidate)
        # The NumPy/OpenCV fallback can round float32 operations differently
        # for sampled and full arrays (a few float32 ULPs on macOS).
        # Keep the pixel comparison tighter than the guard's 1e-6 tolerance.
        np.testing.assert_allclose(preflight[0], full.reshape(-1, 3)[positions], rtol=0, atol=2e-7)

    def test_selector_also_requires_continuous_contrast_preservation(self):
        from Backend.ai.local_correction import local_passes
        base = {"lost_pairs": 100, "recovered": 50, "new_collisions": 4, "mean_lost_distance": 20.}
        self.assertTrue(local_passes({**base, "recovered": 51}, base))
        self.assertFalse(local_passes({**base, "recovered": 51, "mean_lost_distance": 19.9}, base))

    @unittest.skipUnless(local_native.available(), "Build the optional C kernel first")
    def test_native_objective_matches_numpy_loss_and_gradient(self):
        rng = np.random.default_rng(876)
        original = decode_srgb(rng.uniform(.04, .95, (113, 3)))
        base = np.clip(original + rng.normal(0, .015, original.shape), 0, 1)
        weights = memberships(original, original[:7], 25)
        for color in ("protan", "deutan", "tritan"):
            matrix = cvd_matrix(color, 1).astype(float)
            data = pair_data(original, base, matrix, rng, 1700)
            reference = local_objective(original, base, weights, matrix, data, FAST, native=False)
            native = local_objective(original, base, weights, matrix, data, FAST, native=True)
            for _ in range(3):
                parameters = rng.normal(0, 2, (7, 3))
                expected_loss, expected_gradient = reference(parameters)
                loss, gradient = native(parameters)
                self.assertAlmostEqual(loss, expected_loss, places=10)
                np.testing.assert_allclose(gradient, expected_gradient, atol=1e-9, rtol=1e-7)

    @unittest.skipUnless(local_native.available(), "Build the optional C kernel first")
    def test_native_mapping_matches_continuous_reference(self):
        rng = np.random.default_rng(222)
        source = rng.random((40, 70, 3), dtype=np.float32)
        baseline = np.clip(source + rng.normal(0, .08, source.shape), 0, 1).astype(np.float32)
        basis = rng.random((9, 9, 9, 12))
        basis /= basis.sum(axis=-1, keepdims=True)
        parameters = rng.normal(0, 10, (12, 3))
        native = apply_local(source, baseline, basis, parameters, FAST)
        original_lab = linear_lab(decode_srgb(source.reshape(-1, 3).astype(float)))
        base_lab = linear_lab(decode_srgb(baseline.reshape(-1, 3).astype(float)))
        residual = (basis.reshape(-1, 12) @ parameters).reshape(9, 9, 9, 3).astype(np.float32)
        proposed = base_lab + lookup(source.reshape(-1, 3).astype(float), residual)
        radius = np.linalg.norm(base_lab - original_lab, axis=1)
        reference = encode_srgb(lab_to_linear(project_lab(proposed, original_lab, radius))).reshape(source.shape)
        np.testing.assert_allclose(native, reference, atol=5e-5)
        self.assertTrue(np.isfinite(native).all())
        self.assertGreaterEqual(native.min(), 0)
        self.assertLessEqual(native.max(), 1)

    @unittest.skipUnless(local_native.available(), "Build the optional C kernel first")
    def test_native_does_not_make_steps_on_smooth_color_ramps(self):
        t = np.linspace(.04, .96, 8192, dtype=np.float32)
        source = np.stack([t, .8 * t + .03, .6 * t + .1], axis=1)[None]
        baseline = np.clip(source + [.02, -.01, .03], 0, 1).astype(np.float32)
        grid = np.stack(np.meshgrid(*([np.linspace(0, 1, 9)] * 3), indexing="ij"), axis=-1)
        basis = np.stack([grid[..., 0], 1 - grid[..., 0]], axis=-1)
        params = np.array([[2., -3, 1], [-1, 2, -2]])
        result = apply_local(source, baseline, basis, params, FAST)
        # Use continuous Lab, since the report's RGB2Lab table is quantized.
        adjacent = np.linalg.norm(np.diff(continuous_lab(result[0]), axis=0), axis=-1)
        self.assertLess(adjacent.max(), .05)

    @unittest.skipUnless(local_native.available(), "Build the optional C kernel first")
    def test_native_color_partners_match_original_distance_order(self):
        from Backend.ai.fast_correction_baseline import pair_distances
        rng = np.random.default_rng(823)
        normal = rng.normal(size=(163, 3)).astype(np.float32) * 35
        seen = rng.normal(size=(163, 3)).astype(np.float32) * 20
        share = rng.random(163)
        share /= share.sum()
        before, after = pair_distances(normal, normal), pair_distances(seen, seen)
        expected = ((before >= 10) & (after < .6 * before)) @ share
        np.testing.assert_allclose(local_native.color_partners(normal, seen, share, 10, .6), expected, atol=1e-15)

    def test_lab_inverse_and_jacobian(self):
        rgb = np.random.default_rng(57).uniform(.03, .97, (30, 3))
        linear = decode_srgb(rgb)
        lab = linear_lab(linear)
        actual, jac = lab_to_linear(lab, True)
        np.testing.assert_allclose(actual, linear, atol=1e-12)
        numerical = np.empty_like(jac)
        for c in range(3):
            plus, minus = lab.copy(), lab.copy()
            plus[:, c] += 1e-5
            minus[:, c] -= 1e-5
            numerical[:, :, c] = (lab_to_linear(plus) - lab_to_linear(minus)) / 2e-5
        np.testing.assert_allclose(jac, numerical, atol=1e-9)
        np.testing.assert_allclose(continuous_lab(rgb), lab, atol=6e-5)

    def test_projection_is_local_and_has_correct_tangent_gradient(self):
        original = np.array([[30., 5, 5], [70, -5, 3], [80, 0, 0]])
        proposed = original + [[2, 1, 0], [2, 3, 1], [5, 7, 1]]
        radius = np.array([1., 9., 0.])
        result, jac = project_lab(proposed, original, radius, True)
        self.assertTrue((np.linalg.norm(result - original, axis=1) <= radius + 1e-12).all())
        numerical = np.empty_like(jac)
        for c in range(3):
            plus, minus = proposed.copy(), proposed.copy()
            plus[:, c] += 1e-5
            minus[:, c] -= 1e-5
            numerical[:, :, c] = (project_lab(plus, original, radius) - project_lab(minus, original, radius)) / 2e-5
        np.testing.assert_allclose(jac, numerical, atol=1e-8)

    def test_lut_interpolation_matches_reference_including_endpoints(self):
        rng = np.random.default_rng(23)
        cube = rng.normal(size=(7, 7, 7, 12))
        points = np.vstack([rng.random((900, 3)), [0, 0, 0], [1, 1, 1]])
        np.testing.assert_allclose(lookup(points, cube), lookup_lut(points, cube), atol=1e-14)

    def test_gradient_through_bounded_actual_pixels(self):
        original = decode_srgb(np.array([[.75, .25, .2], [.35, .55, .2], [.2, .3, .7], [.6, .5, .1]]))
        baseline = original + [[0, 0, .02], [0, .01, .005], [.01, 0, 0], [0, 0, .01]]
        weights = memberships(original, original, 25)
        matrix = cvd_matrix("deutan", 1).astype(float)
        data = pair_data(original, baseline, matrix, np.random.default_rng(4), 200)
        objective = local_objective(original, baseline, weights, matrix, data, FAST)
        parameters = np.random.default_rng(77).normal(size=(4, 3)) * .4
        analytic = objective(parameters)[1]
        numerical = np.empty_like(parameters)
        for row in range(4):
            for col in range(3):
                plus, minus = parameters.copy(), parameters.copy()
                plus[row, col] += 1e-5
                minus[row, col] -= 1e-5
                numerical[row, col] = (objective(plus)[0] - objective(minus)[0]) / 2e-5
        np.testing.assert_allclose(analytic, numerical, atol=1e-6, rtol=1e-4)

    def test_final_guard_covers_gamut_boundaries_zero_budgets_and_neutrals(self):
        rng = np.random.default_rng(93)
        image = rng.random((31, 47, 3), dtype=np.float32)
        baseline = np.clip(image + rng.normal(0, .02, image.shape), 0, 1).astype(np.float32)
        baseline[:4] = image[:4]
        candidate = np.clip(image + rng.normal(0, .25, image.shape), 0, 1).astype(np.float32)
        output, info = guard_local(image, baseline, candidate)
        original_lab = image_lab(image)
        a = np.linalg.norm(image_lab(baseline) - original_lab, axis=-1)
        b = np.linalg.norm(image_lab(output) - original_lab, axis=-1)
        self.assertTrue((b <= a + 1e-6).all())
        np.testing.assert_array_equal(output[:4], image[:4])
        self.assertEqual(info["local_max_excess"], 0.)

    def test_efficient_baseline_equals_current_correction(self):
        image = np.random.default_rng(29).uniform(.1, .8, (35, 39, 3)).astype(np.float32)
        for color in ("normal", "protan", "deutan", "tritan"):
            for strength in (0., .2, .6, 1.):
                expected = correct_array(image, {"color_type": color, "severity": strength})
                np.testing.assert_array_equal(efficient_baseline(image, color, strength), expected)

    def test_pipeline_deterministic_local_budget_and_fallback(self):
        image = np.random.default_rng(55).uniform(.12, .8, (20, 30, 3)).astype(np.float32)
        before = image.copy()
        base = correct_array(image, {"color_type": "deutan", "severity": 1})
        first, info = correct_local(image, "deutan", baseline=base, config=FAST)
        second, second_info = correct_local(image, "deutan", baseline=base, config=FAST)
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(image, before)
        first_info = {k: v for k, v in info.items() if k != "phases"}
        second_info = {k: v for k, v in second_info.items() if k != "phases"}
        self.assertEqual(first_info, second_info)
        original_lab = image_lab(image)
        self.assertTrue((np.linalg.norm(image_lab(first) - original_lab, axis=-1)
                         <= np.linalg.norm(image_lab(base) - original_lab, axis=-1) + 1e-6).all())
        if not info["selected"]:
            np.testing.assert_array_equal(first, base)
        self.assertEqual(first.dtype, np.float32)
        self.assertTrue(np.isfinite(first).all())

    def test_input_validation_and_identity(self):
        image = np.full((7, 8, 3), .4, np.float32)
        np.testing.assert_array_equal(correct_local(image, "normal")[0], image)
        np.testing.assert_array_equal(correct_local(image, "deutan", 0)[0], image)
        for value in (np.full((2, 2, 3), np.nan), np.ones((3, 3)), np.zeros((0, 2, 3)), image + 1):
            with self.assertRaises(ValueError):
                correct_local(value, "deutan")
        for kwargs in ({"strength": -1}, {"strength": np.nan}, {"baseline": np.zeros((2, 2, 3))}):
            with self.assertRaises(ValueError):
                correct_local(image, "deutan", **kwargs)
        for kwargs in ({"sigma": 0}, {"iterations": 1.5}, {"lut_grid": 1}, {"protection": -1}):
            with self.assertRaises(ValueError):
                LocalConfig(**kwargs)


if __name__ == "__main__":
    unittest.main()
