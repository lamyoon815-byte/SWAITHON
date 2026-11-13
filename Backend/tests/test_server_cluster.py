"""Mode isolation, original selective goldens and bounded v3 fitting."""
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from Backend.ai.correction import color_correction_mode, correct_array, correct_image, daltonize
from Backend.ai import local_native
from Backend.ai.local_correction import LocalConfig, correct_local
from Backend.ai.palette_correction import image_lab
from Backend.ai.server_cluster import ClusterPlan, analysis_copy, apply_plan, correct_cluster
from Backend.tests import test_ai_routes as route_fixtures


FAST = replace(LocalConfig(), training_pixels=128, validation_pixels=128,
               candidate_pairs=2000, fitted_pairs=128, iterations=16, check_every=4)


class CorrectionModeTests(unittest.TestCase):
    def test_default_and_selective_match_original_float_arrays_and_jpeg_bytes(self):
        golden = json.loads((Path(__file__).parent / "fixtures/correction_selective_v1.json").read_text(encoding="utf-8"))
        image = np.random.default_rng(golden["seed"]).integers(0, 256, golden["shape"], dtype=np.uint8).astype(np.float32) / 255
        content = BytesIO()
        Image.fromarray((image * 255).astype(np.uint8)).save(content, format="JPEG", quality=92)
        for mode in (None, "selective"):
            with patch.dict(os.environ, {}):
                if mode is None:
                    os.environ.pop("COLOR_CORRECTION_MODE", None)
                else:
                    os.environ["COLOR_CORRECTION_MODE"] = mode
                for case in golden["cases"]:
                    with self.subTest(mode=mode, profile=case["profile"]):
                        self.assertEqual(sha256(correct_array(image.copy(), case["profile"]).tobytes()).hexdigest(), case["array_sha256"])
                        self.assertEqual(sha256(correct_image(content.getvalue(), case["profile"])).hexdigest(), case["jpeg_sha256"])

    def test_mode_validation_defaults_safely(self):
        for raw, expected in (("", "selective"), ("other", "selective"), ("selective", "selective"), (" CLUSTER ", "cluster")):
            with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": raw}):
                self.assertEqual(color_correction_mode(), expected)

    def test_cluster_routing_keeps_order_and_never_routes_tritan(self):
        image = np.random.default_rng(16).uniform(.1, .7, (18, 21, 3)).astype(np.float32)
        calls = []

        def mapped(rgb, color, level):
            calls.append((color, level))
            return rgb + .01

        profile = {"color_type": "deutan", "color_severities": {"tritan": .8, "deutan": .6, "protan": .4}}
        with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "cluster"}), patch("Backend.ai.server_cluster.correct_cluster", side_effect=mapped):
            actual = correct_array(image, profile)
        self.assertEqual(calls, [("protan", .4), ("deutan", .6)])
        np.testing.assert_array_equal(actual, daltonize(image + .01 + .01, "tritan", .8).astype(np.float32))

    def test_tritan_and_noncolor_processing_are_identical_in_both_modes(self):
        image = np.random.default_rng(11).random((41, 53, 3), dtype=np.float32)
        for color in ("normal", "tritan"):
            profile = {"color_type": color, "severity": .7, "brightness": -12, "contrast": 1.4, "sharpness": .8, "edge": .6}
            with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "selective"}):
                expected = correct_array(image.copy(), profile)
            with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "cluster"}), patch("Backend.ai.server_cluster.correct_cluster", side_effect=AssertionError("must not run")):
                np.testing.assert_array_equal(correct_array(image.copy(), profile), expected)

    def test_zero_color_severities_do_not_run_cluster(self):
        image = np.full((13, 17, 3), .4, np.float32)
        with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "cluster"}), patch("Backend.ai.server_cluster.correct_cluster", side_effect=AssertionError("must not run")):
            np.testing.assert_array_equal(correct_array(image, {"color_type": "deutan", "severity": 0}), image)


class ServerClusterTests(unittest.TestCase):
    def test_concurrent_first_requests_wait_for_native_initialization(self):
        entered, release = Event(), Event()
        library = SimpleNamespace(ready=False)

        def initialize():
            entered.set()
            if not release.wait(5):
                raise TimeoutError("test did not release initialization")
            library.ready = True

        library.initialize_tables = Mock(side_effect=initialize)

        def load(started):
            started.set()
            return local_native._load_library().ready

        with patch.object(local_native, "_library", None), \
             patch.object(local_native.ctypes, "CDLL", return_value=library) as factory, \
             ThreadPoolExecutor(max_workers=4) as pool:
            first = pool.submit(load, Event())
            self.assertTrue(entered.wait(5))
            starts = [Event() for _ in range(3)]
            others = [pool.submit(load, started) for started in starts]
            try:
                self.assertTrue(all(started.wait(5) for started in starts))
            finally:
                release.set()
            self.assertTrue(all(future.result(timeout=5) for future in [first, *others]))
            factory.assert_called_once()
            library.initialize_tables.assert_called_once()

    def test_fitting_is_bounded_and_original_size_only_reaches_application(self):
        image = np.full((801, 1280, 3), .4, np.float32)

        def prepare(small, color, level, config):
            self.assertEqual(max(small.shape[:2]), 1000)
            self.assertFalse(np.shares_memory(image, small))
            return ClusterPlan(color, level, None, None, small.shape[:2], "fixture", config), small

        with patch("Backend.ai.server_cluster.prepare_plan", side_effect=prepare) as fitting, \
             patch("Backend.ai.server_cluster.apply_plan", return_value=image.copy()) as application:
            output = correct_cluster(image, "protan", 1, config=FAST)
        self.assertEqual(output.shape, image.shape)
        fitting.assert_called_once()
        self.assertIs(application.call_args.args[0], image)
        self.assertEqual(analysis_copy(np.zeros((19, 31, 3), np.float32)).shape, (19, 31, 3))

    def test_small_input_matches_frozen_v3_output(self):
        image = np.random.default_rng(65).uniform(.1, .8, (30, 41, 3)).astype(np.float32)
        for color in ("protan", "deutan"):
            expected, _ = correct_local(image, color, .6, config=FAST)
            np.testing.assert_array_equal(correct_cluster(image, color, .6, config=FAST), expected)

    def test_original_application_is_pointwise_bounded_without_refitting(self):
        from Backend.ai.local_correction import efficient_baseline
        image = np.random.default_rng(77).uniform(.08, .9, (129, 97, 3)).astype(np.float32)
        plan = ClusterPlan("deutan", .6, np.ones((3, 3, 3, 1)), np.array([[1., -2., .5]]), (65, 49), "fixture", FAST)
        with patch("Backend.ai.server_cluster.fit", side_effect=AssertionError("must not refit")), \
             patch("Backend.ai.server_cluster.cluster_palette", side_effect=AssertionError("must not recluster")):
            output = apply_plan(image, plan)
        original = image_lab(image)
        baseline = efficient_baseline(image, "deutan", .6)
        a = np.linalg.norm(image_lab(baseline) - original, axis=-1)
        b = np.linalg.norm(image_lab(output) - original, axis=-1)
        self.assertTrue((b.astype(float) - a <= 1e-6).all())
        self.assertEqual(output.shape, image.shape)

    def test_contract_and_invalid_types(self):
        image = np.full((11, 23, 3), .4, np.float32)
        for color in ("tritan", "normal", "unknown"):
            with self.assertRaises(ValueError):
                correct_cluster(image, color, 1)
        with self.assertRaises(ValueError):
            correct_cluster(image, "protan", float("nan"))
        content = BytesIO()
        Image.fromarray((image * 255).astype(np.uint8)).save(content, format="JPEG")
        with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "cluster"}):
            output = correct_image(content.getvalue(), {"color_type": "deutan", "severity": .6})
        with Image.open(BytesIO(output)) as result:
            self.assertEqual((result.format, result.size), ("JPEG", (23, 11)))


class CorrectionModeRouteTests(unittest.TestCase):
    setUp = route_fixtures.AIRouteTests.setUp
    seed = route_fixtures.AIRouteTests.seed

    def test_authenticated_mode_configuration_and_cors(self):
        self.assertEqual(self.client.get("/correction/config").status_code, 401)
        for mode in ("selective", "cluster"):
            with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": mode}):
                response = self.client.get("/correction/config", headers={**self.headers, "Origin": "http://localhost:8081"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"mode": mode})
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("X-Correction-Mode", response.headers["access-control-expose-headers"])

    def test_response_mode_identifies_the_cache_namespace(self):
        self.client.put("/me/profile", headers=self.headers, json={"calibration": {"color_type": "deutan", "severity": .4, "edge": 0}})
        for mode in ("selective", "cluster"):
            with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": mode}):
                response = self.client.post("/correction", headers=self.headers, files={"image": ("x.png", self.image)})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers["X-Correction-Mode"], mode)
            self.assertEqual(response.headers["cache-control"], "no-store")


if __name__ == "__main__":
    unittest.main()
