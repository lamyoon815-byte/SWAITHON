"""Numerical, evaluation and input-contract tests for the isolated experiment."""
from dataclasses import replace
import unittest

import numpy as np

from Backend.ai.correction import simulate
from Backend.ai.cvd_eval import BRETTEL_1997_TRITAN, VIENOT_1999
from Backend.ai.palette_correction import (PaletteConfig, blend_palette, cluster_palette, correct_palette,
                                          decode_srgb, encode_srgb, linear_lab, mean_change,
                                          optimize_palette, palette_objective)
from Backend.ai.palette_evaluation import (MODELS, TYPES, model_matrices, pair_metrics, simulate_held_out)


FAST = replace(PaletteConfig(), sample_pixels=1000, optimizer_iterations=60, restarts=2)


class PaletteCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.image = np.empty((24, 36, 3), np.float32)
        self.image[:, :18] = (0.75, 0.25, 0.2)
        self.image[:, 18:] = (0.35, 0.55, 0.2)

    def test_identity_and_no_confusable_partner(self):
        np.testing.assert_array_equal(correct_palette(self.image, "normal")[0], self.image)
        np.testing.assert_array_equal(correct_palette(self.image, "deutan", 0)[0], self.image)
        solid = np.full((10, 11, 3), (0.75, 0.25, 0.2), np.float32)
        np.testing.assert_array_equal(correct_palette(solid, "deutan", budget=5)[0], solid)

    def test_invalid_inputs(self):
        for image in (np.empty((0, 1, 3)), np.zeros((2, 3)), np.full((2, 2, 3), np.nan), np.ones((2, 2, 3)) * 2):
            with self.assertRaises(ValueError):
                correct_palette(image, "deutan")
        for kwargs in ({"severity": -1}, {"severity": np.nan}, {"budget": -1}, {"budget": np.inf}):
            with self.assertRaises(ValueError):
                correct_palette(self.image, "deutan", **kwargs)
        with self.assertRaises(ValueError):
            PaletteConfig(soft_sigma=0)
        with self.assertRaises(ValueError):
            PaletteConfig(clusters=1.5)

    def test_reproducibility_no_input_or_global_rng_mutation(self):
        before = self.image.copy()
        np.random.seed(29)
        expected = np.random.random(5)
        np.random.seed(29)
        first, info1 = correct_palette(self.image, "deutan", budget=6, config=FAST)
        np.testing.assert_array_equal(np.random.random(5), expected)
        second, info2 = correct_palette(self.image, "deutan", budget=6, config=FAST)
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(self.image, before)
        self.assertEqual(info1, info2)
        self.assertEqual(first.dtype, np.float32)
        self.assertTrue(np.isfinite(first).all())
        self.assertGreaterEqual(float(first.min()), 0)
        self.assertLessEqual(float(first.max()), 1)

    def test_budget_and_machado_separation(self):
        for color in ("protan", "deutan"):
            corrected, info = correct_palette(self.image, color, budget=6, config=FAST)
            self.assertLessEqual(mean_change(self.image, corrected), 6 + 1e-6)
            self.assertGreater(info["confused_palette_pairs"], 0)
            self.assertLess(info["objective_after"], info["objective_before"])
            before = simulate(self.image, color, 1)
            after = simulate(corrected, color, 1)
            from Backend.ai.palette_correction import image_lab
            separation = lambda x: np.linalg.norm(image_lab(x)[12, 5] - image_lab(x)[12, 30])
            self.assertGreater(separation(after), separation(before))
        np.testing.assert_array_equal(correct_palette(self.image, "deutan", budget=0)[0], self.image)

    def test_gradient_against_finite_differences_including_protected_pairs(self):
        palette = decode_srgb(np.array([[0.75, 0.25, 0.2], [0.35, 0.55, 0.2], [0.2, 0.3, 0.7]]))
        from Backend.ai.correction import cvd_matrix
        objective, _, _ = palette_objective(palette, np.array([0.3, 0.4, 0.3]), cvd_matrix("deutan", 1).astype(float), FAST)
        candidate = palette + np.array([[0.002, 0.001, 0.003], [-0.001, 0.002, -0.001], [0, 0, 0]])
        _, gradient = objective(candidate)
        for row in (0, 1):
            for col in range(3):
                plus, minus = candidate.copy(), candidate.copy()
                plus[row, col] += 1e-6
                minus[row, col] -= 1e-6
                numerical = (objective(plus)[0] - objective(minus)[0]) / 2e-6
                self.assertAlmostEqual(gradient[row, col], numerical, delta=max(1e-3, abs(numerical) * 1e-4))

    def test_inactive_centroid_stays_fixed(self):
        image = np.concatenate([self.image, np.full((24, 18, 3), (0.05, 0.1, 0.95), np.float32)], axis=1)
        palette, shares = cluster_palette(image, FAST)
        from Backend.ai.correction import cvd_matrix
        _, active, _ = palette_objective(palette, shares, cvd_matrix("deutan", 1).astype(float), FAST)
        self.assertTrue((~active).any())
        moved, _ = optimize_palette(palette, shares, "deutan", FAST)
        np.testing.assert_array_equal(moved[~active], palette[~active])

    def test_soft_mapping_is_continuous_and_chunk_independent(self):
        ramp = np.linspace(0.25, 0.75, 800, dtype=np.float32)
        image = np.stack([ramp, 0.7 - ramp / 2, np.full_like(ramp, 0.3)], axis=-1)[None]
        palette = decode_srgb(image[:, [0, -1]].reshape(2, 3).astype(float))
        moved = np.clip(palette + [[0, 0, 0.03], [0, 0, -0.02]], 0, 1)
        output = blend_palette(image, palette, moved, FAST)
        other = blend_palette(image, palette, moved, replace(FAST, chunk_pixels=17))
        np.testing.assert_allclose(output, other, atol=1e-7)
        self.assertLess(float(np.abs(np.diff(output, axis=1)).max()), 0.003)
        np.testing.assert_allclose(encode_srgb(decode_srgb(image)), image, atol=2e-7)
        np.testing.assert_allclose(linear_lab(np.array([[1.0, 1, 1]])), [[100, 0, 0]], atol=3e-5)


class HeldOutEvaluationTests(unittest.TestCase):
    def test_matrices_match_existing_independent_references(self):
        for color in ("protan", "deutan"):
            np.testing.assert_allclose(model_matrices("vienot", color)[0], VIENOT_1999[color], atol=1e-5)
        first, second, separator = model_matrices("brettel", "tritan")
        np.testing.assert_allclose(first, BRETTEL_1997_TRITAN["plane1"], atol=1e-5)
        np.testing.assert_allclose(second, BRETTEL_1997_TRITAN["plane2"], atol=1e-5)
        np.testing.assert_allclose(separator, BRETTEL_1997_TRITAN["normal"], atol=1e-5)

    def test_neutral_axis_and_identity_for_every_model(self):
        image = np.repeat(np.linspace(0, 1, 21, dtype=np.float32)[None, :, None], 3, axis=2)
        for model in MODELS:
            for color in TYPES:
                np.testing.assert_allclose(simulate_held_out(image, model, color), image, atol=2e-4)
                np.testing.assert_array_equal(simulate_held_out(image, model, color, 0), image)

    def test_recovery_uses_original_pairs_and_exposes_new_collisions(self):
        original = np.array([[[0, 0, 0], [20, 0, 0], [40, 0, 0]]], float)
        before = np.array([[[0, 0, 0], [2, 0, 0], [40, 0, 0]]], float)
        after = np.array([[[0, 0, 0], [15, 0, 0], [19, 0, 0]]], float)
        indices = np.array([[0, 1], [1, 2], [0, 2]])
        metrics = pair_metrics(original, before, after, indices)
        self.assertEqual(metrics["lost_pairs"], 1)
        self.assertEqual(metrics["recovered_pairs"], 1)
        self.assertEqual(metrics["new_collisions"], 2)
        empty = pair_metrics(original, original, original, indices)
        self.assertIsNone(empty["recovery"])


class ExperimentDecisionTests(unittest.TestCase):
    def test_aggregation_uses_pair_counts_and_excludes_undefined_macro_values(self):
        from Backend.ai.palette_experiment import aggregate

        def measurement(lost, recovered):
            return {"lost_pairs": lost, "recovered_pairs": recovered,
                    "recovery": recovered / lost if lost else None,
                    "safe_pairs": 0, "new_collisions": 0, "lost_boundaries": 0,
                    "boundary_visibility": None, "low_count": lost < 20}

        rows = [{"model": "brettel", "color_type": "protan", "baseline": measurement(lost, restored),
                 "candidate": measurement(lost, restored)} for lost, restored in ((10, 1), (100, 99), (0, 0))]
        summary = next(row for row in aggregate(rows) if row["model"] == "brettel" and row["color_type"] == "protan")
        self.assertAlmostEqual(summary["baseline"]["micro_recovery"], 100 / 110)
        self.assertAlmostEqual(summary["baseline"]["macro_recovery"], (0.1 + 0.99) / 2)

    def test_any_failed_predeclared_condition_prevents_success(self):
        from copy import deepcopy
        from Backend.ai.palette_experiment import STRENGTHS, assess
        result = {"summary": [{"model": model, "color_type": color,
                               "baseline": {"micro_recovery": 0.5}, "candidate": {"micro_recovery": 0.6}}
                              for model in MODELS for color in TYPES],
                  "timings": [{"candidate_delta_e": 2.0, "baseline_delta_e": 2.1, "candidate_seconds": 2.9}],
                  "plates": [{"model": model, "color_type": color, "strength": strength,
                              "baseline_contrast": 10.0, "candidate_contrast": 11.0}
                             for model in MODELS for color in TYPES for strength in STRENGTHS for _ in range(4)]}
        self.assertTrue(assess(result)["numeric_pass"])
        # A tie, a color-budget overshoot, a slow image, or a plate loss is enough
        # to reject the overall improvement even if all other metrics improve.
        for failure in ("tie", "budget", "time", "plate"):
            changed = deepcopy(result)
            if failure == "tie":
                changed["summary"][0]["candidate"]["micro_recovery"] = 0.5
            elif failure == "budget":
                changed["timings"][0]["candidate_delta_e"] = 2.2
            elif failure == "time":
                changed["timings"][0]["candidate_seconds"] = 3.01
            else:
                changed["plates"][0]["candidate_contrast"] = 5.0
            self.assertFalse(assess(changed)["numeric_pass"], failure)


if __name__ == "__main__":
    unittest.main()
