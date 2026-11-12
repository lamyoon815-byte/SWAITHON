"""Server adaptation of frozen v3: fit <=1000px, map original pixels only.

No optimizer or clustering runs on the original-resolution array. The v3
modules remain unchanged so their experiment implementation stays inspectable.
"""
from dataclasses import dataclass, replace

import cv2
import numpy as np

from . import local_native
from .correction import cvd_matrix
from .local_correction import (LocalConfig, apply_local, centroid_guard, efficient_baseline,
                               fit, guard_local, local_passes, local_quality)
from .palette_correction import PaletteConfig, cluster_palette, decode_srgb
from .pixel_correction import build_basis_lut, pair_data


ANALYSIS_SIDE = 1000
APPLICATION_ROWS = 64


@dataclass(frozen=True)
class ClusterPlan:
    color: str
    strength: float
    basis: np.ndarray | None
    parameters: np.ndarray | None
    analysis_shape: tuple[int, int]
    reason: str
    config: LocalConfig


def analysis_copy(image):
    height, width = image.shape[:2]
    ratio = min(1., ANALYSIS_SIDE / max(height, width))
    if ratio == 1:
        return image.copy()
    return cv2.resize(image, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv2.INTER_AREA)


def prepare_plan(small, color, strength, config):
    """Fit and validate v3 on an already bounded analysis copy."""
    if max(small.shape[:2]) > ANALYSIS_SIDE:
        raise ValueError("Cluster fitting input must be at most 1000px")
    baseline = efficient_baseline(small, color, strength)
    palette, _ = cluster_palette(small, replace(PaletteConfig(), clusters=config.clusters, sample_pixels=4096, kmeans_iterations=25))
    basis = build_basis_lut(palette, config)
    matrix = cvd_matrix(color, 1.).astype(float)
    parameters, info, positions = fit(small, baseline, basis, matrix, config, strength)
    if parameters is None:
        plan = ClusterPlan(color, strength, None, None, small.shape[:2], info["reason"], config)
        return plan, baseline
    # The original experiment checks the actual, guarded output. Keep that
    # gate before accepting coefficients for an original-resolution picture.
    corrected = apply_local(small, baseline, basis, parameters, config)
    corrected, _ = guard_local(small, baseline, corrected)
    original = decode_srgb(small.reshape(-1, 3)[positions].astype(float))
    base = decode_srgb(baseline.reshape(-1, 3)[positions].astype(float))
    validation = pair_data(original, base, matrix, np.random.default_rng(config.seed + 1), config.candidate_pairs)
    validation["centroid_guard"] = centroid_guard(original, matrix)
    measured = local_quality(decode_srgb(corrected.reshape(-1, 3)[positions].astype(float)), matrix, validation)
    if not local_passes(measured, info["baseline_validation"]):
        return ClusterPlan(color, strength, None, None, small.shape[:2], "no_guarded_gain", config), baseline
    return ClusterPlan(color, strength, basis, parameters, small.shape[:2], "validated_v3", config), corrected


def apply_plan(image, plan):
    """Only pointwise color mapping/guarding at original resolution.

    A' analyzes its spatial selection mask at <=600px. It never fits a palette
    or an optimizer at original resolution. Row blocks bound mapping memory.
    """
    baseline = efficient_baseline(image, plan.color, plan.strength)
    if plan.parameters is None:
        return baseline
    residual = (plan.basis.reshape(-1, len(plan.parameters)) @ plan.parameters).reshape(*plan.basis.shape[:3], 3).astype(np.float32)
    output = np.empty_like(image)
    for start in range(0, len(image), APPLICATION_ROWS):
        source = image[start:start + APPLICATION_ROWS]
        base = baseline[start:start + APPLICATION_ROWS]
        if local_native.available():
            proposed = local_native.map_local(source, base, residual)
        else:
            proposed = apply_local(source, base, plan.basis, plan.parameters, plan.config, native=False)
        output[start:start + APPLICATION_ROWS], _ = guard_local(source, base, proposed)
    return output


def correct_cluster(rgb, color, strength, *, config=LocalConfig()):
    if color not in ("protan", "deutan"):
        raise ValueError("Server cluster mode supports protan/deutan only")
    if not np.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError("Strength must be finite and between 0 and 1")
    image = np.asarray(rgb, np.float32)
    if image.ndim != 3 or image.shape[-1] != 3 or not image.size:
        raise ValueError("Expected a nonempty H x W x 3 image")
    if not np.isfinite(image).all() or image.min() < 0 or image.max() > 1:
        raise ValueError("Pixels must be finite and between 0 and 1")
    if strength == 0:
        return image.copy()
    small = analysis_copy(image)
    plan, corrected_small = prepare_plan(small, color, strength, config)
    if small.shape == image.shape:
        return corrected_small
    return apply_plan(image, plan)
