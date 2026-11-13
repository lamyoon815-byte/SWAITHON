"""V2: refine A' using actual pixel pairs, with Machado-only candidate selection.

K-means defines a smooth color function; fitting and validation use actual
pixels after this function, rather than isolated representative-color pairs.
This experimental module is not imported by the app/server correction routes.
"""
from dataclasses import asdict, dataclass, replace

import numpy as np

from .correction import correct_array, cvd_matrix
from .palette_correction import (PaletteConfig, cluster_palette, decode_srgb,
                                 encode_srgb, linear_lab, mean_change)


@dataclass(frozen=True)
class PixelConfig:
    clusters: int = 12
    training_pixels: int = 1536
    validation_pixels: int = 2048
    candidate_pairs: int = 60000
    fitted_pairs: int = 2048
    iterations: int = 80
    check_every: int = 8
    learning_rate: float = 0.004
    sigma: float = 14.0
    max_linear_residual: float = 0.12
    target_ratio: float = 0.58
    logistic_slope: float = 12.0
    protection: float = 12.0
    budget_penalty: float = 30.0
    regularization: float = 0.002
    seed: int = 20261114
    chunk_pixels: int = 32768
    lut_grid: int = 33

    def __post_init__(self):
        for name in ("clusters", "training_pixels", "validation_pixels", "candidate_pairs",
                     "fitted_pairs", "iterations", "check_every", "chunk_pixels", "lut_grid"):
            if not isinstance(getattr(self, name), int) or getattr(self, name) <= 0:
                raise ValueError(f"{name} must be a positive integer")
        for name in ("learning_rate", "sigma", "max_linear_residual", "logistic_slope"):
            if not np.isfinite(getattr(self, name)) or getattr(self, name) <= 0:
                raise ValueError(f"{name} must be finite and positive")
        if not 0.5 < self.target_ratio < 1:
            raise ValueError("target_ratio must be between 0.5 and 1")
        if self.lut_grid < 2:
            raise ValueError("lut_grid must be at least 2")
        for name in ("protection", "budget_penalty", "regularization"):
            if not np.isfinite(getattr(self, name)) or getattr(self, name) < 0:
                raise ValueError(f"{name} must be finite and nonnegative")


def memberships(linear, palette, sigma):
    lab, centers = linear_lab(linear), linear_lab(palette)
    distances = np.sum(lab ** 2, axis=1)[:, None] + np.sum(centers ** 2, axis=1)[None] - 2 * lab @ centers.T
    logits = -np.maximum(distances, 0) / (2 * sigma ** 2)
    logits -= logits.max(axis=1, keepdims=True)
    weights = np.exp(logits)
    return weights / weights.sum(axis=1, keepdims=True)


def lookup_lut(rgb, cube):
    """Continuous trilinear lookup, including exact 0/1 channel endpoints."""
    position = np.clip(rgb, 0, 1) * (cube.shape[0] - 1)
    lower = np.minimum(np.floor(position).astype(np.intp), cube.shape[0] - 2)
    fraction = position - lower
    output = np.zeros((len(rgb), cube.shape[-1]), dtype=np.float64)
    for red in (0, 1):
        for green in (0, 1):
            for blue in (0, 1):
                coefficient = (fraction[:, 0] if red else 1 - fraction[:, 0])
                coefficient = coefficient * (fraction[:, 1] if green else 1 - fraction[:, 1])
                coefficient = coefficient * (fraction[:, 2] if blue else 1 - fraction[:, 2])
                output += coefficient[:, None] * cube[lower[:, 0] + red, lower[:, 1] + green, lower[:, 2] + blue]
    return output


def build_basis_lut(palette, config):
    values = np.linspace(0, 1, config.lut_grid)
    grid = np.stack(np.meshgrid(values, values, values, indexing="ij"), axis=-1)
    weights = memberships(decode_srgb(grid.reshape(-1, 3)), palette, config.sigma)
    return weights.reshape(config.lut_grid, config.lut_grid, config.lut_grid, len(palette))


def seen_lab(linear, matrix, jacobian=False):
    raw = linear @ matrix.T
    if not jacobian:
        return linear_lab(np.clip(raw, 0, 1))
    lab, jac = linear_lab(np.clip(raw, 0, 1), jacobian=True)
    jac *= ((raw >= 0) & (raw <= 1))[:, None, :]
    return lab, jac @ matrix


def pair_data(original, baseline, matrix, rng, count):
    pairs = rng.integers(0, len(original), size=(count, 2))
    distance = lambda lab: np.linalg.norm(lab[pairs[:, 0]] - lab[pairs[:, 1]], axis=1)
    normal = distance(linear_lab(original))
    before = distance(seen_lab(original, matrix))
    after = distance(seen_lab(baseline, matrix))
    eligible = normal > 15
    lost = eligible & (before < 0.5 * normal)
    safe = eligible & ~lost
    return {"pairs": pairs, "normal": normal, "original_seen": before,
            "baseline_seen": after, "lost": lost, "safe": safe}


def quality(linear, matrix, data):
    lab = seen_lab(linear, matrix)
    pairs, normal = data["pairs"], data["normal"]
    after = np.linalg.norm(lab[pairs[:, 0]] - lab[pairs[:, 1]], axis=1)
    lost_count = int(data["lost"].sum())
    recovered = int((data["lost"] & (after >= 0.5 * normal)).sum())
    collisions = int((data["safe"] & (after < 0.5 * normal)).sum())
    return {"lost_pairs": lost_count, "recovered": recovered,
            "recovery": recovered / lost_count if lost_count else None,
            "new_collisions": collisions}


def passes(candidate, baseline):
    return (candidate["lost_pairs"] >= 20 and candidate["recovered"] > baseline["recovered"]
            and candidate["new_collisions"] <= baseline["new_collisions"])


def pixel_objective(original, baseline, weights, matrix, data, config):
    """Loss/analytic gradient through actual pixels, soft assignment and clipping."""
    original_lab = linear_lab(original)
    sample_budget = float(np.linalg.norm(linear_lab(baseline) - original_lab, axis=1).mean())
    left, right = data["pairs"].T
    normal = np.maximum(data["normal"], 1e-6)
    lost, safe = data["lost"], data["safe"]
    lost_weights = lost.astype(float) / max(int(lost.sum()), 1)
    safe_weights = safe.astype(float) / max(int(safe.sum()), 1)
    protected_target = np.minimum(np.maximum(data["original_seen"], data["baseline_seen"]) / normal, 0.58)

    def objective(parameters):
        raw = baseline + weights @ parameters
        candidate = np.clip(raw, 0, 1)
        simulated, sim_jac = seen_lab(candidate, matrix, jacobian=True)
        differences = simulated[left] - simulated[right]
        distance = np.sqrt(np.sum(differences ** 2, axis=1) + 1e-12)
        ratio = distance / normal
        z = config.logistic_slope * (config.target_ratio - ratio)
        loss = float(np.sum(lost_weights * np.logaddexp(0, z)))
        derivative = -lost_weights * config.logistic_slope / (1 + np.exp(np.clip(-z, -60, 60))) / normal
        missing = np.maximum(protected_target - ratio, 0)
        loss += float(config.protection * np.sum(safe_weights * missing ** 2))
        derivative -= 2 * config.protection * safe_weights * missing / normal
        pair_gradient = (derivative / distance)[:, None] * differences
        lab_gradient = np.zeros_like(candidate)
        np.add.at(lab_gradient, left, pair_gradient)
        np.add.at(lab_gradient, right, -pair_gradient)
        gradient = np.einsum("...i,...ij->...j", lab_gradient, sim_jac)
        lab, jac = linear_lab(candidate, jacobian=True)
        displacement = lab - original_lab
        amount = np.sqrt(np.sum(displacement ** 2, axis=1) + 1e-10)
        relative_excess = max(float(amount.mean()) / max(sample_budget, 1e-6) - 1, 0)
        loss += config.budget_penalty * relative_excess ** 2
        preserve_gradient = (2 * config.budget_penalty * relative_excess / max(sample_budget, 1e-6) / len(candidate)) * displacement / amount[:, None]
        loss += config.regularization * float(np.mean(np.sum(displacement ** 2, axis=1))) / (1 + sample_budget ** 2)
        preserve_gradient += (2 * config.regularization / len(candidate) / (1 + sample_budget ** 2)) * displacement
        gradient += np.einsum("...i,...ij->...j", preserve_gradient, jac)
        gradient *= (raw >= 0) & (raw <= 1)
        return loss, weights.T @ gradient

    return objective


def apply_residual(original, baseline_linear, basis_lut, parameters, config):
    source = original.reshape(-1, 3)
    residual_lut = (basis_lut.reshape(-1, len(parameters)) @ parameters).reshape(*basis_lut.shape[:3], 3)
    base = baseline_linear
    output = np.empty_like(source)
    for start in range(0, len(source), config.chunk_pixels):
        stop = start + config.chunk_pixels
        shift = lookup_lut(source[start:stop].astype(float), residual_lut)
        output[start:stop] = encode_srgb(base[start:stop] + shift)
    return output.reshape(original.shape)


def fit_residual(original, baseline, basis_lut, matrix, config, strength):
    rng = np.random.default_rng(config.seed)
    total = min(len(original), config.training_pixels + config.validation_pixels)
    positions = rng.choice(len(original), total, replace=False)
    split = min(config.training_pixels, max(1, total // 2))
    train_positions, val_positions = positions[:split], positions[split:]
    if not len(val_positions):
        return None, {"reason": "too_few_pixels"}, val_positions
    train, train_base = original[train_positions], baseline[train_positions]
    val, val_base = original[val_positions], baseline[val_positions]
    training = pair_data(train, train_base, matrix, rng, config.candidate_pairs)
    validation = pair_data(val, val_base, matrix, np.random.default_rng(config.seed + 1), config.candidate_pairs)
    baseline_quality = quality(val_base, matrix, validation)
    diagnostics = {"baseline_validation": baseline_quality}
    if int(training["lost"].sum()) < 20 or baseline_quality["lost_pairs"] < 20:
        return None, {**diagnostics, "reason": "too_few_lost_pairs"}, val_positions
    if baseline_quality["recovered"] == baseline_quality["lost_pairs"]:
        return None, {**diagnostics, "reason": "baseline_already_recovers_all"}, val_positions
    # Retain actual confused pairs and protected pairs, without ever looking at
    # held-out observer models or the final experiment's random pixel pairs.
    keep = []
    for mask in (training["lost"], training["safe"]):
        available = np.flatnonzero(mask)
        keep.extend(rng.choice(available, min(config.fitted_pairs, len(available)), replace=False))
    keep = np.asarray(keep, dtype=int)
    training = {name: values[keep] for name, values in training.items()}
    weights = lookup_lut(encode_srgb(train), basis_lut)
    val_weights = lookup_lut(encode_srgb(val), basis_lut)
    objective = pixel_objective(train, train_base, weights, matrix, training, config)
    parameters = np.zeros((basis_lut.shape[-1], 3))
    momentum, velocity = np.zeros_like(parameters), np.zeros_like(parameters)
    best_parameters, best_quality, best_loss = None, baseline_quality, float("inf")
    initial_loss = objective(parameters)[0]
    for iteration in range(1, config.iterations + 1):
        loss, gradient = objective(parameters)
        if not np.isfinite(loss) or not np.isfinite(gradient).all():
            break
        momentum = 0.9 * momentum + 0.1 * gradient
        velocity = 0.999 * velocity + 0.001 * gradient ** 2
        step = config.learning_rate * (momentum / (1 - 0.9 ** iteration)) / (np.sqrt(velocity / (1 - 0.999 ** iteration)) + 1e-8)
        bound = config.max_linear_residual * strength
        parameters = np.clip(parameters - step, -bound, bound)
        if iteration % config.check_every == 0 or iteration == config.iterations:
            candidate = np.clip(val_base + val_weights @ parameters, 0, 1)
            measured = quality(candidate, matrix, validation)
            candidate_loss = objective(parameters)[0]
            if passes(measured, baseline_quality) and (measured["recovered"] > best_quality["recovered"] or
                    (measured["recovered"] == best_quality["recovered"] and candidate_loss < best_loss)):
                best_parameters, best_quality, best_loss = parameters.copy(), measured, candidate_loss
    diagnostics.update({"initial_loss": initial_loss, "best_loss": best_loss if best_parameters is not None else None,
                        "candidate_validation": best_quality, "reason": "candidate" if best_parameters is not None else "no_validation_gain"})
    return best_parameters, diagnostics, val_positions


def correct_pixels(rgb, color_type, strength=1.0, *, baseline=None, config=PixelConfig()):
    """Return a validated A' refinement or exactly A', plus selection diagnostics."""
    image = np.asarray(rgb, np.float32)
    if image.ndim != 3 or image.shape[2] != 3 or not image.size:
        raise ValueError("Expected a nonempty H x W x 3 image")
    if not np.isfinite(image).all() or image.min() < 0 or image.max() > 1:
        raise ValueError("Pixels must be finite and between 0 and 1")
    if color_type not in ("normal", "protan", "deutan", "tritan") or not np.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError("Invalid color_type or strength")
    metadata = {"config": asdict(config), "fit_model": "Machado 2009", "selected": False, "reason": "identity", "budget_scale": 1.0}
    if color_type == "normal" or strength == 0:
        return image.copy(), {**metadata, "budget": 0.0, "mean_delta_e": 0.0}
    if baseline is None:
        baseline = correct_array(image, {"color_type": color_type, "severity": strength})
    baseline = np.asarray(baseline, np.float32)
    if baseline.shape != image.shape or not np.isfinite(baseline).all() or baseline.min() < 0 or baseline.max() > 1:
        raise ValueError("Baseline must match the image shape and range")
    budget = mean_change(image, baseline)
    metadata.update({"budget": budget, "mean_delta_e": budget})
    if budget <= 1e-6:
        return baseline.copy(), {**metadata, "reason": "no_color_budget"}
    palette_config = replace(PaletteConfig(), clusters=config.clusters, sample_pixels=4096, kmeans_iterations=25)
    palette, _ = cluster_palette(image, palette_config)
    basis_lut = build_basis_lut(palette, config)
    original_linear = decode_srgb(image.reshape(-1, 3).astype(float))
    baseline_linear = decode_srgb(baseline.reshape(-1, 3).astype(float))
    matrix = cvd_matrix(color_type, 1.0).astype(float)
    parameters, diagnostics, val_positions = fit_residual(original_linear, baseline_linear, basis_lut, matrix, config, strength)
    metadata.update(diagnostics)
    if parameters is None:
        return baseline.copy(), metadata
    corrected = apply_residual(image, baseline_linear, basis_lut, parameters, config)
    displacement, scale = corrected - image, 1.0
    change = mean_change(image, corrected)
    for _ in range(8):
        if change <= budget + 1e-6:
            break
        scale *= 0.99 * budget / max(change, 1e-12)
        corrected = np.clip(image + scale * displacement, 0, 1).astype(np.float32)
        change = mean_change(image, corrected)
    metadata.update({"candidate_mean_delta_e": change, "budget_scale": scale})
    if change > budget + 1e-6:
        return baseline.copy(), {**metadata, "reason": "full_image_budget_failed"}
    # Validate the actual, gamut-clipped, budget-scaled output, not just the
    # unconstrained parameter proposal. Uses only the private Machado split.
    val_original = original_linear[val_positions]
    val_base = baseline_linear[val_positions]
    validation = pair_data(val_original, val_base, matrix, np.random.default_rng(config.seed + 1), config.candidate_pairs)
    candidate_quality = quality(decode_srgb(corrected.reshape(-1, 3)[val_positions].astype(float)), matrix, validation)
    metadata["final_validation"] = candidate_quality
    if not passes(candidate_quality, metadata["baseline_validation"]):
        return baseline.copy(), {**metadata, "reason": "gain_lost_after_budget_projection"}
    return corrected, {**metadata, "selected": True, "reason": "validated_pixel_gain", "mean_delta_e": change}
