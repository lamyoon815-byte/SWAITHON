"""Experimental v3: bounded local color changes and sampled, per-image fitting.

The app still uses correction.py. Only Machado is used by this module; other
observer models belong to the final evaluator. A' is both the starting point
and the per-pixel color-change budget, rather than only a global mean budget.
"""
from dataclasses import asdict, dataclass, replace
from time import perf_counter

import cv2
import numpy as np

from .correction import (COLOR_BIN, COLOR_BLUR, COLOR_MIN_DELTA_E, COLOR_NEED,
                         CONFUSION_LOST_RATIO, CONFUSION_SIZE, _boundary_weight,
                         _confusion_lab, cvd_matrix, daltonize)
from .fast_correction_baseline import pair_distances
from . import local_native
from .palette_correction import (LAB_FROM_F, WHITE, XYZ, PaletteConfig,
                                 cluster_palette, decode_srgb, encode_srgb,
                                 image_lab, linear_lab)
from .pixel_correction import build_basis_lut, pair_data, passes, seen_lab


@dataclass(frozen=True)
class LocalConfig:
    clusters: int = 12
    training_pixels: int = 1536
    validation_pixels: int = 2048
    candidate_pairs: int = 60000
    fitted_pairs: int = 2048
    iterations: int = 48
    check_every: int = 8
    learning_rate: float = 0.4
    sigma: float = 14.0
    max_lab_residual: float = 18.0
    target_ratio: float = 0.58
    logistic_slope: float = 12.0
    protection: float = 12.0
    regularization: float = 0.002
    seed: int = 20261115
    chunk_pixels: int = 16384
    lut_grid: int = 33

    def __post_init__(self):
        for name in ("clusters", "training_pixels", "validation_pixels", "candidate_pairs",
                     "fitted_pairs", "iterations", "check_every", "chunk_pixels", "lut_grid"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        for name in ("learning_rate", "sigma", "max_lab_residual", "logistic_slope"):
            value = getattr(self, name)
            if not np.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name in ("protection", "regularization"):
            value = getattr(self, name)
            if not np.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        if not 0.5 < self.target_ratio < 1 or self.lut_grid < 2:
            raise ValueError("Invalid target ratio or LUT size")
        if not isinstance(self.seed, int) or self.seed < 0:
            raise ValueError("seed must be a nonnegative integer")


F_FROM_LAB = np.array([[1 / 116, 1 / 500, 0],
                       [1 / 116, 0, 0], [1 / 116, 0, -1 / 200]])
LINEAR_FROM_XYZ = np.linalg.inv(XYZ / WHITE[:, None])


def length(vectors):
    """Euclidean length of RGB/Lab vectors, avoiding a short-axis reduction."""
    return np.sqrt(vectors[..., 0] ** 2 + vectors[..., 1] ** 2 + vectors[..., 2] ** 2)


def lab_to_linear(lab, jacobian=False):
    """Continuous inverse of linear_lab; retain float32 for full-image mapping."""
    dtype = np.asarray(lab).dtype
    transform = F_FROM_LAB.astype(dtype, copy=False)
    matrix = LINEAR_FROM_XYZ.astype(dtype, copy=False)
    f = lab @ transform.T + 16 / 116
    threshold = 6 / 29
    xyz = np.where(f > threshold, f ** 3, 3 * threshold ** 2 * (f - 4 / 29))
    linear = xyz @ matrix.T
    if not jacobian:
        return linear
    derivative = np.where(f > threshold, 3 * f ** 2, 3 * threshold ** 2)
    return linear, np.einsum("ab,...b,bc->...ac", matrix, derivative, transform)


def continuous_lab(rgb):
    """Nonquantized Lab with float32 intermediates for the final image."""
    linear = decode_srgb(np.asarray(rgb, np.float32))
    xyz = linear @ (XYZ / WHITE[:, None]).astype(np.float32).T
    threshold = (6 / 29) ** 3
    f = np.where(xyz > threshold, np.cbrt(np.maximum(xyz, threshold)),
                 xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return f @ LAB_FROM_F.astype(np.float32).T + np.array([-16, 0, 0], np.float32)


def project_lab(proposed, original, radius, jacobian=False):
    """Project each color onto its own A' displacement ball in continuous Lab."""
    displacement = proposed - original
    distance = length(displacement)
    scale = np.minimum(1, radius / np.maximum(distance, 1e-20))
    projected = original + displacement * scale[:, None]
    if not jacobian:
        return projected
    unit = displacement / np.maximum(distance[:, None], 1e-20)
    tangent = np.eye(3) - unit[:, :, None] * unit[:, None, :]
    projection = np.where((distance > radius)[:, None, None],
                          scale[:, None, None] * tangent, np.eye(3))
    return projected, projection


def lookup(rgb, cube):
    """Trilinear interpolation using flat gathers and seven nested lerps."""
    size = cube.shape[0]
    points = np.clip(rgb, 0, 1) * (size - 1)
    lower = np.minimum(points.astype(np.intp), size - 2)
    fraction = points - lower.astype(points.dtype)
    flat = cube.reshape(-1, cube.shape[-1])
    index = (lower[:, 0] * size + lower[:, 1]) * size + lower[:, 2]
    f = [fraction[:, channel:channel + 1] for channel in range(3)]
    # x + t*(y-x) is continuous at cell boundaries, including 0/1 endpoints.
    lerp = lambda first, second, t: first + t * (second - first)
    x00 = lerp(flat[index], flat[index + 1], f[2])
    x01 = lerp(flat[index + size], flat[index + size + 1], f[2])
    x10 = lerp(flat[index + size * size], flat[index + size * size + 1], f[2])
    x11 = lerp(flat[index + size * size + size], flat[index + size * size + size + 1], f[2])
    return lerp(lerp(x00, x01, f[1]), lerp(x10, x11, f[1]), f[0])


def bounded_pixels(original_lab, baseline_lab, weights, parameters, jacobian=False):
    radius = length(baseline_lab - original_lab)
    proposed = baseline_lab + weights @ parameters
    if not jacobian:
        return np.clip(lab_to_linear(project_lab(proposed, original_lab, radius)), 0, 1)
    projected, projection = project_lab(proposed, original_lab, radius, True)
    raw, inverse = lab_to_linear(projected, True)
    inverse *= ((raw >= 0) & (raw <= 1))[:, :, None]
    return np.clip(raw, 0, 1), inverse @ projection


def centroid_guard(original, matrix):
    """Three coarse unsupervised color groups, used only to preserve contrast.

    A binary pair-recovery score can improve while two broad color regions
    become less distinct. The fixed original groups detect that failure without
    knowing image semantics, calibration labels, or a held-out observer model.
    """
    normal = linear_lab(original)
    centers = [normal[length(normal - normal.mean(axis=0)).argmax()]]
    nearest = np.full(len(normal), np.inf)
    for _ in range(2):
        nearest = np.minimum(nearest, np.sum((normal - centers[-1]) ** 2, axis=1))
        if nearest.max() <= 1e-12:
            break
        centers.append(normal[nearest.argmax()])
    centers = np.array(centers)
    for _ in range(12):
        labels = np.sum((normal[:, None] - centers[None]) ** 2, axis=-1).argmin(axis=1)
        updated = np.array([normal[labels == k].mean(axis=0) if (labels == k).any() else centers[k] for k in range(len(centers))])
        if np.max(np.abs(updated - centers)) < 1e-8:
            break
        centers = updated
    count = np.bincount(labels, minlength=len(centers))
    before = seen_lab(original, matrix)
    means = np.array([before[labels == k].mean(axis=0) if count[k] else np.zeros(3) for k in range(len(centers))])
    left, right = np.triu_indices(len(centers), 1)
    difference = length(centers[left] - centers[right])
    confused = (count[left] > 0) & (count[right] > 0) & (difference > 15) & (length(means[left] - means[right]) < .5 * difference)
    return {"labels": labels, "count": count, "left": left[confused], "right": right[confused]}


def local_quality(linear, matrix, data):
    lab = seen_lab(linear, matrix)
    left, right = data["pairs"].T
    distance = length(lab[left] - lab[right])
    lost_count = int(data["lost"].sum())
    recovered = int((data["lost"] & (distance >= .5 * data["normal"])).sum())
    contrasts = []
    if "centroid_guard" in data:
        guard = data["centroid_guard"]
        means = np.stack([np.bincount(guard["labels"], lab[:, c], minlength=len(guard["count"])) for c in range(3)], axis=1)
        means /= np.maximum(guard["count"][:, None], 1)
        contrasts = length(means[guard["left"]] - means[guard["right"]]).tolist()
    return {"lost_pairs": lost_count, "recovered": recovered,
            "recovery": recovered / lost_count if lost_count else None,
            "new_collisions": int((data["safe"] & (distance < .5 * data["normal"])).sum()),
            "mean_lost_distance": float(distance[data["lost"]].mean()) if lost_count else 0.,
            "centroid_contrasts": contrasts}


def local_passes(candidate, baseline):
    # Preserve continuous contrast as well as the binary recovery threshold.
    return (passes(candidate, baseline) and candidate["mean_lost_distance"] >= baseline["mean_lost_distance"] - 1e-6
            and all(a >= b - 1e-6 for a, b in zip(candidate.get("centroid_contrasts", []), baseline.get("centroid_contrasts", []))))


def local_objective(original, baseline, weights, matrix, data, config, *, native=True):
    original_lab, baseline_lab = linear_lab(original), linear_lab(baseline)
    budget = float(length(baseline_lab - original_lab).mean())
    left, right = data["pairs"].T
    normal = np.maximum(data["normal"], 1e-6)
    lost_weights = data["lost"].astype(float) / max(int(data["lost"].sum()), 1)
    safe_weights = data["safe"].astype(float) / max(int(data["safe"].sum()), 1)
    target = np.minimum(np.maximum(data["original_seen"], data["baseline_seen"]) / normal, .58)
    if native and local_native.available():
        return local_native.make_objective(original_lab, baseline_lab, weights, matrix, data["pairs"], normal,
                                            lost_weights, safe_weights, target, config, budget)

    def objective(parameters):
        candidate, mapping = bounded_pixels(original_lab, baseline_lab, weights, parameters, True)
        simulated, sim_jac = seen_lab(candidate, matrix, True)
        differences = simulated[left] - simulated[right]
        distance = np.sqrt(np.sum(differences ** 2, axis=1) + 1e-12)
        ratio = distance / normal
        z = config.logistic_slope * (config.target_ratio - ratio)
        loss = float(np.sum(lost_weights * np.logaddexp(0, z)))
        derivative = -lost_weights * config.logistic_slope / (1 + np.exp(np.clip(-z, -60, 60))) / normal
        missing = np.maximum(target - ratio, 0)
        loss += float(config.protection * np.sum(safe_weights * missing ** 2))
        derivative -= 2 * config.protection * safe_weights * missing / normal
        pair_gradient = (derivative / distance)[:, None] * differences
        # Bincount avoids repeated scatter updates for shared pixel endpoints.
        lab_gradient = np.stack([np.bincount(left, pair_gradient[:, c], minlength=len(original))
                                 - np.bincount(right, pair_gradient[:, c], minlength=len(original))
                                 for c in range(3)], axis=1)
        gradient = np.einsum("...i,...ij->...j", lab_gradient, sim_jac)
        lab, jac = linear_lab(candidate, True)
        displacement = lab - original_lab
        loss += config.regularization * float(np.mean(np.sum(displacement ** 2, axis=1))) / (1 + budget ** 2)
        preserve = 2 * config.regularization / len(candidate) / (1 + budget ** 2) * displacement
        gradient += np.einsum("...i,...ij->...j", preserve, jac)
        gradient = np.einsum("...i,...ij->...j", gradient, mapping)
        return loss, weights.T @ gradient

    return objective


def fit(image, baseline, basis, matrix, config, strength):
    rng = np.random.default_rng(config.seed)
    total = min(image.shape[0] * image.shape[1], config.training_pixels + config.validation_pixels)
    positions = rng.choice(image.shape[0] * image.shape[1], total, replace=False)
    split = min(config.training_pixels, max(1, total // 2))
    if total <= split:
        return None, {"reason": "too_few_pixels"}, positions[split:]
    # Decode only sampled pixels, instead of two full-resolution arrays.
    source = image.reshape(-1, 3)[positions].astype(float)
    before = baseline.reshape(-1, 3)[positions].astype(float)
    original, base = decode_srgb(source), decode_srgb(before)
    train, val = original[:split], original[split:]
    train_base, val_base = base[:split], base[split:]
    training = pair_data(train, train_base, matrix, rng, config.candidate_pairs)
    validation = pair_data(val, val_base, matrix, np.random.default_rng(config.seed + 1), config.candidate_pairs)
    validation["centroid_guard"] = centroid_guard(val, matrix)
    base_quality = local_quality(val_base, matrix, validation)
    info = {"baseline_validation": base_quality}
    if int(training["lost"].sum()) < 20 or base_quality["lost_pairs"] < 20:
        return None, {**info, "reason": "too_few_lost_pairs"}, positions[split:]
    if base_quality["recovered"] == base_quality["lost_pairs"]:
        return None, {**info, "reason": "baseline_already_recovers_all"}, positions[split:]
    keep = []
    for mask in (training["lost"], training["safe"]):
        available = np.flatnonzero(mask)
        keep.extend(rng.choice(available, min(config.fitted_pairs, len(available)), replace=False))
    training = {key: value[np.asarray(keep, int)] for key, value in training.items()}
    weights = lookup(source, basis)
    train_weights, val_weights = weights[:split], weights[split:]
    objective = local_objective(train, train_base, train_weights, matrix, training, config)
    original_lab, baseline_lab = linear_lab(val), linear_lab(val_base)
    parameters = np.zeros((basis.shape[-1], 3))
    momentum, velocity = np.zeros_like(parameters), np.zeros_like(parameters)
    best_parameters, best_quality, best_loss = None, base_quality, float("inf")
    initial_loss = objective(parameters)[0]
    for iteration in range(1, config.iterations + 1):
        loss, gradient = objective(parameters)
        if not np.isfinite(loss) or not np.isfinite(gradient).all():
            break
        momentum = .9 * momentum + .1 * gradient
        velocity = .999 * velocity + .001 * gradient ** 2
        step = config.learning_rate * momentum / (1 - .9 ** iteration) / (np.sqrt(velocity / (1 - .999 ** iteration)) + 1e-8)
        bound = config.max_lab_residual * strength
        parameters = np.clip(parameters - step, -bound, bound)
        if iteration % config.check_every == 0 or iteration == config.iterations:
            candidate = bounded_pixels(original_lab, baseline_lab, val_weights, parameters)
            measured = local_quality(candidate, matrix, validation)
            candidate_loss = objective(parameters)[0]
            if local_passes(measured, base_quality) and (measured["recovered"] > best_quality["recovered"] or
                    (measured["recovered"] == best_quality["recovered"] and candidate_loss < best_loss)):
                best_parameters, best_quality, best_loss = parameters.copy(), measured, candidate_loss
    info.update({"initial_loss": initial_loss, "best_loss": best_loss if best_parameters is not None else None,
                 "candidate_validation": best_quality, "reason": "candidate" if best_parameters is not None else "no_validation_gain"})
    return best_parameters, info, positions[split:]


def apply_local(image, baseline, basis, parameters, config, *, native=True):
    source, base = image.reshape(-1, 3), baseline.reshape(-1, 3)
    residual = (basis.reshape(-1, len(parameters)) @ parameters).reshape(*basis.shape[:3], 3).astype(np.float32)
    if native and local_native.available():
        return local_native.map_local(image, baseline, residual)
    output = np.empty_like(source)
    for start in range(0, len(source), config.chunk_pixels):
        stop = start + config.chunk_pixels
        original_lab, baseline_lab = continuous_lab(source[start:stop]), continuous_lab(base[start:stop])
        radius = length(baseline_lab - original_lab)
        proposed = baseline_lab + lookup(source[start:stop], residual).astype(np.float32)
        projected = project_lab(proposed, original_lab, radius)
        # Lab2LRGB has no gamma input table and is continuous, unlike RGB2Lab.
        linear = cv2.cvtColor(projected[None], cv2.COLOR_Lab2LRGB)[0]
        output[start:stop] = encode_srgb(linear)
    return output.reshape(image.shape)


def guard_local(image, baseline, candidate):
    """Check the actual OpenCV ΔE used in the report, including gamut clipping.

    Continuous projection can drift on gamut boundaries or the evaluator's Lab
    lookup quantization. Shrink only excess pixels, then use A' for any residue.
    This guard is followed by validation of the actual final output.
    """
    original_lab = image_lab(image).reshape(-1, 3)
    budget = length(image_lab(baseline).reshape(-1, 3) - original_lab)
    output = candidate.reshape(-1, 3).copy()
    source = image.reshape(-1, 3)
    actual = length(image_lab(candidate).reshape(-1, 3) - original_lab)
    initial_excess = 0
    for iteration in range(4):
        excess = actual.astype(float) - budget > 1e-6
        if iteration == 0:
            initial_excess = int(excess.sum())
        if not excess.any():
            break
        factor = .97 * budget[excess] / np.maximum(actual[excess], 1e-20)
        output[excess] = source[excess] + factor[:, None] * (output[excess] - source[excess])
        actual[excess] = length(image_lab(output[excess][None])[0] - original_lab[excess])
    remaining = actual.astype(float) - budget > 1e-6
    output[remaining] = baseline.reshape(-1, 3)[remaining]
    actual[remaining] = budget[remaining]
    return output.reshape(image.shape), {"budget": float(budget.mean()), "mean_delta_e": float(actual.mean()),
                    "guard_shrunk_pixels": initial_excess, "guard_baseline_pixels": int(remaining.sum()),
                    "local_max_excess": float(np.maximum(actual - budget, 0).max()),
                    "baseline_delta_e_p99": float(np.percentile(budget, 99)),
                    "candidate_delta_e_p99": float(np.percentile(actual, 99))}


def efficient_baseline(image, color_type, strength):
    """A' distance operation order, without casting boolean blocks for BLAS."""
    if color_type == "normal" or strength <= 0:
        return image.copy()
    if color_type == "tritan":
        return daltonize(image, color_type, strength, None).astype(np.float32)
    height, width = image.shape[:2]
    ratio = min(1., CONFUSION_SIZE / max(height, width))
    small = image if ratio == 1 else cv2.resize(image, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv2.INTER_AREA)
    normal, seen = _confusion_lab(small, color_type)
    cells = np.floor((normal.reshape(-1, 3) + np.array([0, 128, 128], np.float32)) / COLOR_BIN).astype(np.int64)
    key = (cells[:, 0] * 1000 + cells[:, 1]) * 1000 + cells[:, 2]
    _, index, count = np.unique(key, return_inverse=True, return_counts=True)
    index = index.ravel()
    colors = np.stack([np.bincount(index, small.reshape(-1, 3)[:, c], minlength=len(count)) for c in range(3)], axis=1)
    colors = (colors / count[:, None]).astype(np.float32)[None]
    normal_c, seen_c = (lab[0] for lab in _confusion_lab(colors, color_type))
    share, partner = count / count.sum(), np.zeros(len(count))
    if local_native.available():
        partner = local_native.color_partners(normal_c, seen_c, share, COLOR_MIN_DELTA_E, CONFUSION_LOST_RATIO)
    else:
        for start in range(0, len(count), 64):
            before = pair_distances(normal_c[start:start + 64], normal_c)
            after = pair_distances(seen_c[start:start + 64], seen_c)
            confused = (before >= COLOR_MIN_DELTA_E) & (after < CONFUSION_LOST_RATIO * before)
            partner[start:start + 64] = np.einsum("ij,j->i", confused, share)
    weight = np.clip(partner / COLOR_NEED, 0, 1)[index].reshape(small.shape[:2]).astype(np.float32)
    mask = np.maximum(_boundary_weight(normal, seen), cv2.GaussianBlur(weight, (0, 0), COLOR_BLUR))
    if ratio != 1:
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
    return daltonize(image, color_type, strength, mask.astype(np.float32)).astype(np.float32)


def correct_local(rgb, color_type, strength=1., *, baseline=None, config=LocalConfig()):
    """Fit bounded Lab offsets; return exactly A' unless actual pixels improve."""
    start = perf_counter()
    image = np.asarray(rgb, np.float32)
    if image.ndim != 3 or image.shape[2] != 3 or not image.size:
        raise ValueError("Expected a nonempty H x W x 3 image")
    if not np.isfinite(image).all() or image.min() < 0 or image.max() > 1:
        raise ValueError("Pixels must be finite and between 0 and 1")
    if color_type not in ("normal", "protan", "deutan", "tritan") or not np.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError("Invalid color_type or strength")
    info = {"config": asdict(config), "fit_model": "Machado 2009", "selected": False, "reason": "identity",
            "native_mapping": local_native.available()}
    if color_type == "normal" or strength == 0:
        return image.copy(), {**info, "budget": 0., "mean_delta_e": 0., "local_max_excess": 0.}
    if baseline is None:
        baseline = efficient_baseline(image, color_type, strength)
    baseline = np.asarray(baseline, np.float32)
    if baseline.shape != image.shape or not np.isfinite(baseline).all() or baseline.min() < 0 or baseline.max() > 1:
        raise ValueError("Baseline must match the image shape and range")
    phases = {"baseline": perf_counter() - start}
    start = perf_counter()
    palette, _ = cluster_palette(image, replace(PaletteConfig(), clusters=config.clusters, sample_pixels=4096, kmeans_iterations=25))
    basis = build_basis_lut(palette, config)
    phases["basis"] = perf_counter() - start
    start = perf_counter()
    matrix = cvd_matrix(color_type, 1.).astype(float)
    parameters, details, positions = fit(image, baseline, basis, matrix, config, strength)
    phases["fit"] = perf_counter() - start
    info.update(details)
    info["phases"] = phases
    if parameters is None:
        return baseline.copy(), info
    start = perf_counter()
    # Pointwise mapping/guarding of the private validation split is equivalent
    # to reading these pixels after full-image mapping. Reject before mapping
    # every pixel if this actual-output preflight loses the predicted gain.
    val_rgb = image.reshape(-1, 3)[positions][None]
    val_base_rgb = baseline.reshape(-1, 3)[positions][None]
    val = decode_srgb(val_rgb[0].astype(float))
    val_base = decode_srgb(val_base_rgb[0].astype(float))
    data = pair_data(val, val_base, matrix, np.random.default_rng(config.seed + 1), config.candidate_pairs)
    data["centroid_guard"] = centroid_guard(val, matrix)
    preflight = apply_local(val_rgb, val_base_rgb, basis, parameters, config)
    preflight, _ = guard_local(val_rgb, val_base_rgb, preflight)
    measured = local_quality(decode_srgb(preflight[0].astype(float)), matrix, data)
    info["preflight_validation"] = measured
    phases["preflight"] = perf_counter() - start
    if not local_passes(measured, info["baseline_validation"]):
        return baseline.copy(), {**info, "reason": "gain_lost_in_local_preflight"}
    start = perf_counter()
    output = apply_local(image, baseline, basis, parameters, config)
    output, guard_info = guard_local(image, baseline, output)
    info.update(guard_info)
    phases["apply_guard"] = perf_counter() - start
    start = perf_counter()
    measured = local_quality(decode_srgb(output.reshape(-1, 3)[positions].astype(float)), matrix, data)
    info["final_validation"] = measured
    phases["final_validation"] = perf_counter() - start
    if not local_passes(measured, info["baseline_validation"]):
        return baseline.copy(), {**info, "reason": "gain_lost_after_local_projection", "mean_delta_e": info["budget"]}
    return output, {**info, "selected": True, "reason": "validated_local_gain"}
