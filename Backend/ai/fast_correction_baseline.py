"""Memory-efficient execution of the existing single-type A' color correction.

The distance subtraction/square/add/square-root order is kept in float32 to
match correction.py, while avoiding the large M x N x 3 temporary arrays.
This is an execution optimization, not a different recoloring objective.
"""
import cv2
import numpy as np

from .correction import (COLOR_BIN, COLOR_BLUR, COLOR_MIN_DELTA_E, COLOR_NEED,
                         CONFUSION_LOST_RATIO, CONFUSION_SIZE,
                         _boundary_weight, _confusion_lab, daltonize)


def pair_distances(first, second):
    dtype = np.result_type(first.dtype, second.dtype)
    distance = np.empty((len(first), len(second)), dtype=dtype)
    temporary = np.empty_like(distance)
    np.subtract(first[:, None, 0], second[None, :, 0], out=distance)
    np.square(distance, out=distance)
    for channel in (1, 2):
        np.subtract(first[:, None, channel], second[None, :, channel], out=temporary)
        np.square(temporary, out=temporary)
        np.add(distance, temporary, out=distance)
    np.sqrt(distance, out=distance)
    return distance


def color_weight(small, color_type, normal):
    flat = normal.reshape(-1, 3)
    cells = np.floor((flat + np.array([0, 128, 128], dtype=np.float32)) / COLOR_BIN).astype(np.int64)
    key = (cells[:, 0] * 1000 + cells[:, 1]) * 1000 + cells[:, 2]
    _, index, count = np.unique(key, return_inverse=True, return_counts=True)
    index = index.ravel()
    colors = np.zeros((len(count), 3), dtype=np.float64)
    np.add.at(colors, index, small.reshape(-1, 3))
    colors = (colors / count[:, None]).astype(np.float32)[None]
    normal_c, seen_c = (lab[0] for lab in _confusion_lab(colors, color_type))
    share = count / count.sum()
    partner = np.zeros(len(count))
    for start in range(0, len(count), 128):
        before = pair_distances(normal_c[start:start + 128], normal_c)
        after = pair_distances(seen_c[start:start + 128], seen_c)
        confused = (before >= COLOR_MIN_DELTA_E) & (after < CONFUSION_LOST_RATIO * before)
        partner[start:start + 128] = confused @ share
    weight = np.clip(partner / COLOR_NEED, 0, 1)[index].reshape(small.shape[:2]).astype(np.float32)
    return cv2.GaussianBlur(weight, (0, 0), COLOR_BLUR)


def confusion_weight(rgb, color_type):
    height, width = rgb.shape[:2]
    ratio = min(1.0, CONFUSION_SIZE / max(height, width))
    small = rgb if ratio == 1 else cv2.resize(rgb, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv2.INTER_AREA)
    normal, seen = _confusion_lab(small, color_type)
    mask = np.maximum(_boundary_weight(normal, seen), color_weight(small, color_type, normal))
    if ratio != 1:
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
    return mask.astype(np.float32)


def fast_baseline(rgb, color_type, strength):
    """Same single-type, neutral-tone A' output, with smaller temporaries."""
    if color_type == "normal" or strength <= 0:
        return rgb.astype(np.float32)
    weight = confusion_weight(rgb, color_type) if color_type != "tritan" else None
    return daltonize(rgb, color_type, strength, weight).astype(np.float32)


def correct_pixels_fast(rgb, color_type, strength=1.0, *, config=None):
    """Execute v2 with the equivalent, lower-memory A' calculation."""
    from .pixel_correction import PixelConfig, correct_pixels
    image = np.asarray(rgb, np.float32)
    if image.ndim != 3 or image.shape[2] != 3 or not image.size:
        raise ValueError("Expected a nonempty H x W x 3 image")
    if not np.isfinite(image).all() or image.min() < 0 or image.max() > 1:
        raise ValueError("Pixels must be finite and between 0 and 1")
    if color_type not in ("normal", "protan", "deutan", "tritan") or not np.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError("Invalid color_type or strength")
    baseline = fast_baseline(image, color_type, strength)
    return correct_pixels(image, color_type, strength, baseline=baseline, config=config or PixelConfig())
