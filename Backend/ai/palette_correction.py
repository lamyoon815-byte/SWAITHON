"""Experimental unsupervised palette clustering + per-image optimization.

This module is deliberately not imported by correction.py or the HTTP routes.
Only Machado is used to fit the palette; held-out simulators belong in the
experiment runner. No neural network or labelled training data is used.
"""
from dataclasses import asdict, dataclass

import cv2
import numpy as np

from .correction import correct_array, cvd_matrix


@dataclass(frozen=True)
class PaletteConfig:
    clusters: int = 12
    sample_pixels: int = 12000
    kmeans_iterations: int = 40
    optimizer_iterations: int = 180
    restarts: int = 3
    learning_rate: float = 0.012
    seed: int = 20261112
    minimum_difference: float = 10.0
    confusion_ratio: float = 0.6
    target_ratio: float = 0.65
    preservation: float = 0.08
    collision_penalty: float = 2.0
    maximum_delta_e: float = 25.0
    soft_sigma: float = 10.0
    chunk_pixels: int = 32768

    def __post_init__(self):
        positive = (self.clusters, self.sample_pixels, self.kmeans_iterations,
                    self.optimizer_iterations, self.restarts, self.learning_rate,
                    self.minimum_difference, self.maximum_delta_e,
                    self.soft_sigma, self.chunk_pixels)
        if any(not np.isfinite(value) or value <= 0 for value in positive):
            raise ValueError("Palette sizes, iterations and scales must be positive")
        for name in ("clusters", "sample_pixels", "kmeans_iterations",
                     "optimizer_iterations", "restarts", "chunk_pixels", "seed"):
            value = getattr(self, name)
            if not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a nonnegative integer")
        if not 0 < self.confusion_ratio <= self.target_ratio <= 1:
            raise ValueError("Require 0 < confusion_ratio <= target_ratio <= 1")
        if any(not np.isfinite(v) or v < 0 for v in (self.preservation, self.collision_penalty)):
            raise ValueError("Loss penalties must be finite and nonnegative")


XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                [0.2126729, 0.7151522, 0.0721750],
                [0.0193339, 0.1191920, 0.9503041]])
WHITE = np.array([0.95047, 1.0, 1.08883])
LAB_FROM_F = np.array([[0, 116, 0], [500, -500, 0], [0, 200, -200]])


def decode_srgb(rgb):
    rgb = np.asarray(rgb)
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def encode_srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92,
                    1.055 * linear ** (1 / 2.4) - 0.055)


def linear_lab(linear, jacobian=False):
    """Continuous CIELAB/D65, avoiding LUT quantization during optimization."""
    matrix = XYZ / WHITE[:, None]
    xyz = np.asarray(linear) @ matrix.T
    threshold = (6 / 29) ** 3
    cubic = np.cbrt(np.maximum(xyz, threshold))
    f = np.where(xyz > threshold, cubic, xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    lab = f @ LAB_FROM_F.T + np.array([-16, 0, 0])
    if not jacobian:
        return lab
    derivative = np.where(xyz > threshold, 1 / (3 * cubic ** 2), 1 / (3 * (6 / 29) ** 2))
    jac = np.einsum("ab,...b,bc->...ac", LAB_FROM_F, derivative, matrix)
    return lab, jac


def image_lab(rgb):
    return cv2.cvtColor(np.asarray(rgb, np.float32), cv2.COLOR_RGB2LAB)


def mean_change(original, corrected):
    return float(np.linalg.norm(image_lab(corrected) - image_lab(original), axis=-1).mean())


def cluster_palette(rgb, config=PaletteConfig()):
    """Seeded k-means++/Lloyd in Lab; never changes NumPy/OpenCV global RNG."""
    flat = rgb.reshape(-1, 3)
    rng = np.random.default_rng(config.seed)
    positions = rng.choice(len(flat), min(len(flat), config.sample_pixels), replace=False)
    sample = flat[positions]
    values = image_lab(sample[None])[0].astype(np.float64)
    unique = np.unique(values, axis=0)
    count = min(config.clusters, len(unique))
    centers = [values[rng.integers(len(values))]]
    nearest = np.full(len(values), np.inf)
    for _ in range(1, count):
        nearest = np.minimum(nearest, np.sum((values - centers[-1]) ** 2, axis=1))
        if nearest.sum() <= 1e-12:
            break
        centers.append(values[rng.choice(len(values), p=nearest / nearest.sum())])
    centers = np.asarray(centers)
    previous = None
    for _ in range(config.kmeans_iterations):
        distances = np.sum((values[:, None] - centers[None]) ** 2, axis=-1)
        labels = distances.argmin(axis=1)
        if previous is not None and np.array_equal(labels, previous):
            break
        previous = labels.copy()
        for index in range(len(centers)):
            selected = labels == index
            centers[index] = values[selected].mean(axis=0) if selected.any() else values[distances.min(axis=1).argmax()]
    # RGB centroids are computed in linear light, with the same membership.
    linear = decode_srgb(sample.astype(np.float64))
    palette, shares = [], []
    for index in range(len(centers)):
        selected = labels == index
        if selected.any():
            palette.append(linear[selected].mean(axis=0))
            shares.append(float(selected.mean()))
    return np.asarray(palette), np.asarray(shares)


def palette_objective(original, shares, matrix, config):
    """Return differentiable loss/gradient and the movable centroid mask."""
    original_lab = linear_lab(original)
    seen_lab = linear_lab(np.clip(original @ matrix.T, 0, 1))
    left, right = np.triu_indices(len(original), 1)
    normal = np.linalg.norm(original_lab[left] - original_lab[right], axis=1)
    seen = np.linalg.norm(seen_lab[left] - seen_lab[right], axis=1)
    eligible = normal >= config.minimum_difference
    confused = eligible & (seen < config.confusion_ratio * normal)
    protected = eligible & ~confused
    active = np.zeros(len(original), dtype=bool)
    active[left[confused]] = True
    active[right[confused]] = True
    target = np.where(confused, config.target_ratio * normal,
                      np.minimum(seen, config.confusion_ratio * normal))
    weights = shares[left] * shares[right]
    coefficients = np.zeros_like(weights)
    if confused.any():
        coefficients[confused] = weights[confused] / weights[confused].sum()
    if protected.any():
        coefficients[protected] = config.collision_penalty * weights[protected] / weights[protected].sum()

    def objective(candidate):
        lab, lab_jac = linear_lab(candidate, jacobian=True)
        raw_seen = candidate @ matrix.T
        simulated, sim_jac = linear_lab(np.clip(raw_seen, 0, 1), jacobian=True)
        differences = simulated[left] - simulated[right]
        distances = np.sqrt(np.sum(differences ** 2, axis=1) + 1e-12)
        missing = np.maximum(target - distances, 0)
        loss = float(np.sum(coefficients * missing ** 2))
        pair_grad = (-2 * coefficients * missing / distances)[:, None] * differences
        seen_grad = np.zeros_like(candidate)
        np.add.at(seen_grad, left, pair_grad)
        np.add.at(seen_grad, right, -pair_grad)
        raw_grad = np.einsum("...i,...ij->...j", seen_grad, sim_jac)
        raw_grad *= (raw_seen >= 0) & (raw_seen <= 1)
        gradient = raw_grad @ matrix
        displacement = lab - original_lab
        amount = np.sqrt(np.sum(displacement ** 2, axis=1) + 1e-12)
        overflow = np.maximum(amount - config.maximum_delta_e, 0)
        loss += float(config.preservation * np.sum(shares * amount ** 2) + 2 * np.sum(shares * overflow ** 2))
        keep_grad = (2 * config.preservation * shares + 4 * shares * overflow / amount)[:, None] * displacement
        gradient += np.einsum("...i,...ij->...j", keep_grad, lab_jac)
        gradient[~active] = 0
        return loss, gradient

    return objective, active, int(confused.sum())


def optimize_palette(palette, shares, color_type, config):
    matrix = cvd_matrix(color_type, 1.0).astype(np.float64)
    objective, active, pairs = palette_objective(palette, shares, matrix, config)
    initial_loss = objective(palette)[0]
    best, best_loss = palette.copy(), initial_loss
    rng = np.random.default_rng(config.seed + 1)
    if pairs:
        for restart in range(config.restarts):
            current = palette.copy()
            if restart:
                current = np.clip(current + rng.normal(0, 0.015, current.shape) * active[:, None], 0, 1)
            momentum, velocity = np.zeros_like(current), np.zeros_like(current)
            for iteration in range(1, config.optimizer_iterations + 1):
                loss, gradient = objective(current)
                if np.isfinite(loss) and loss < best_loss:
                    best, best_loss = current.copy(), loss
                if not np.all(np.isfinite(gradient)):
                    break
                momentum = 0.9 * momentum + 0.1 * gradient
                velocity = 0.999 * velocity + 0.001 * gradient ** 2
                step = config.learning_rate * (momentum / (1 - 0.9 ** iteration)) / (np.sqrt(velocity / (1 - 0.999 ** iteration)) + 1e-8)
                current = np.clip(current - step, 0, 1)
                current[~active] = palette[~active]
            loss, _ = objective(current)
            if np.isfinite(loss) and loss < best_loss:
                best, best_loss = current.copy(), loss
    return best, {"confused_palette_pairs": pairs, "active_centroids": int(active.sum()),
                  "objective_before": initial_loss, "objective_after": best_loss}


def blend_palette(rgb, palette, moved, config):
    """Gaussian membership in every centroid, in bounded-memory pixel chunks."""
    flat = rgb.reshape(-1, 3)
    output = np.empty_like(flat)
    # OpenCV's float RGB->Lab uses an internal lookup table. Its quantization
    # can turn smooth membership changes into visible steps on gradients.
    centers = linear_lab(palette)
    shifts = moved - palette
    for start in range(0, len(flat), config.chunk_pixels):
        chunk = flat[start:start + config.chunk_pixels]
        chunk_linear = decode_srgb(chunk.astype(np.float64))
        lab = linear_lab(chunk_linear)
        squared = np.sum((lab[:, None] - centers[None]) ** 2, axis=-1)
        logits = -squared / (2 * config.soft_sigma ** 2)
        logits -= logits.max(axis=1, keepdims=True)
        membership = np.exp(logits)
        membership /= membership.sum(axis=1, keepdims=True)
        linear = chunk_linear + membership @ shifts
        output[start:start + len(chunk)] = encode_srgb(linear)
    return output.reshape(rgb.shape)


def correct_palette(rgb, color_type, severity=1.0, *, budget=None, config=PaletteConfig()):
    """Return (experimental RGB float32 image, diagnostics).

    budget is the A' mean DeltaE76 on this very input, never a held-out recovery
    score. If omitted, A' is computed here, so its cost is part of the method.
    Strength scales a palette fit at Machado severity 1.0, as a correction dial.
    This experimental single-type API deliberately does not accept app profiles.
    """
    image = np.asarray(rgb, dtype=np.float32)
    if image.ndim != 3 or image.shape[2] != 3 or not image.size:
        raise ValueError("Expected a nonempty H x W x 3 sRGB image")
    if not np.isfinite(image).all() or image.min() < 0 or image.max() > 1:
        raise ValueError("sRGB pixels must be finite and between 0 and 1")
    if color_type not in ("normal", "protan", "deutan", "tritan"):
        raise ValueError("Unknown color_type")
    if not np.isfinite(severity) or not 0 <= severity <= 1:
        raise ValueError("Severity must be finite and between 0 and 1")
    if budget is not None and (not np.isfinite(budget) or budget < 0):
        raise ValueError("Color-change budget must be finite and nonnegative")
    metadata = {"config": asdict(config), "fit_model": "Machado 2009",
                "optimizer": "projected Adam", "strength": float(severity),
                "clusters": 0, "confused_palette_pairs": 0, "active_centroids": 0,
                "objective_before": 0.0, "objective_after": 0.0, "budget_scale": 1.0}
    if color_type == "normal" or severity == 0:
        return image.copy(), {**metadata, "mean_delta_e": 0.0, "budget": 0.0}
    if budget is None:
        baseline = correct_array(image, {"color_type": color_type, "severity": severity})
        budget = mean_change(image, baseline)
    metadata["budget"] = float(budget)
    if budget <= 1e-6:
        return image.copy(), {**metadata, "mean_delta_e": 0.0}
    palette, shares = cluster_palette(image, config)
    moved, diagnostics = optimize_palette(palette, shares, color_type, config)
    metadata.update(diagnostics)
    metadata["clusters"] = len(palette)
    if not diagnostics["confused_palette_pairs"]:
        return image.copy(), {**metadata, "mean_delta_e": 0.0}
    corrected = blend_palette(image, palette, palette + severity * (moved - palette), config)
    # Enforce the original-color constraint on actual output pixels, after gamut
    # clipping and soft assignment. Do not select using evaluation simulators.
    displacement = corrected - image
    scale = 1.0
    change = mean_change(image, corrected)
    for _ in range(8):
        if change <= budget + 1e-6:
            break
        scale *= 0.98 * budget / max(change, 1e-12)
        corrected = np.clip(image + scale * displacement, 0, 1).astype(np.float32)
        change = mean_change(image, corrected)
    if change > budget + 1e-6:
        corrected, change, scale = image.copy(), 0.0, 0.0
    return corrected, {**metadata, "mean_delta_e": change, "budget_scale": scale}
