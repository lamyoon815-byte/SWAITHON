"""Held-out CVD models for the palette experiment; never imported by fitting.

Model constants and projection conventions follow DaltonLens-Python:
https://github.com/DaltonLens/DaltonLens-Python (simulate.py, convert.py).
Brettel/Vischeck/HPE share the Brettel algorithm with different cone models.
HPE is only a sensitivity check; Vienot is inaccurate for tritanopia.

MIT License -- Copyright (c) 2021 DaltonLens
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
from functools import lru_cache

import numpy as np

from .palette_correction import decode_srgb, encode_srgb, image_lab


MODELS = ("brettel", "vienot", "vischeck", "hpe")
TYPES = ("protan", "deutan", "tritan")
XYZ_SRGB = np.array([[0.412456, 0.3575761, 0.1804375],
                     [0.212672, 0.7151522, 0.0721750],
                     [0.019333, 0.1191920, 0.9503041]])
XYZ_JUDD_VOS = 0.01 * np.array([[40.9568, 35.5041, 17.9167],
                               [21.3389, 70.6743, 7.98680],
                               [1.86297, 11.4620, 91.2367]])
SMITH_POKORNY = np.array([[0.15514, 0.54312, -0.03286],
                         [-0.15514, 0.45684, 0.03286],
                         [0, 0, 0.01608]])
VIS_LMS = np.array([[0.05059983, 0.08585369, 0.00952420],
                    [0.01893033, 0.08925308, 0.01370054],
                    [0.00292202, 0.00975732, 0.07145979]])
HPE = np.array([[0.4002, 0.7076, -0.0808],
                [-0.2263, 1.1653, 0.0457], [0, 0, 0.9182]])
ANCHORS_JV = {475: [0.13287, 0.11284, 0.9422], 575: [0.84394, 0.91558, 0.00197],
              485: [0.05699, 0.16987, 0.5864], 660: [0.16161, 0.061, 0.00001]}
ANCHORS_XYZ = {475: [0.1421, 0.1126, 1.0419], 575: [0.8425, 0.9154, 0.0018],
               485: [0.05795, 0.1693, 0.6162], 660: [0.1649, 0.061, 0.0]}
ANCHORS_VIS = {475: [1.22694, 0.87814, 7.85903], 575: [5.65322, 6.43625, -0.2219],
               485: [0.79132, 1.4793, 4.85354], 660: [0.90089, 0.21688, -0.04599]}


def project_plane(normal, missing):
    result = np.eye(3)
    result[missing] = -normal / normal[missing]
    result[missing, missing] = 0
    return result


@lru_cache(maxsize=12)
def model_matrices(model, color_type):
    if model not in MODELS or color_type not in TYPES:
        raise ValueError("Unknown evaluation model or color type")
    missing = TYPES.index(color_type)
    if model == "vischeck":
        lms_from_rgb = VIS_LMS
        lms_from_xyz = VIS_LMS @ np.linalg.inv(XYZ_SRGB)
        anchors = ANCHORS_VIS
    elif model == "hpe":
        lms_from_xyz = HPE
        lms_from_rgb = HPE @ XYZ_SRGB
        anchors = ANCHORS_XYZ
    else:
        lms_from_xyz = SMITH_POKORNY
        lms_from_rgb = SMITH_POKORNY @ XYZ_JUDD_VOS
        anchors = ANCHORS_JV
    rgb_from_lms = np.linalg.inv(lms_from_rgb)
    white = lms_from_rgb @ np.ones(3)
    if model == "vienot":
        if color_type == "tritan":
            one = lms_from_rgb @ [1, 0, 0]
            two = lms_from_rgb @ [0, 1, 1]
        else:
            one = lms_from_rgb @ [0, 0, 1]
            two = lms_from_rgb @ [1, 1, 0]
        projection = project_plane(np.cross(one, two), missing)
        transform = rgb_from_lms @ projection @ lms_from_rgb
        return transform, transform, np.zeros(3)
    wavelengths = (485, 660) if color_type == "tritan" else (475, 575)
    wing1, wing2 = [lms_from_xyz @ anchors[wavelength] for wavelength in wavelengths]
    separator = np.cross(white, np.eye(3)[missing])
    if separator @ wing1 < 0:
        wing1, wing2 = wing2, wing1
    first = rgb_from_lms @ project_plane(np.cross(white, wing1), missing) @ lms_from_rgb
    second = rgb_from_lms @ project_plane(np.cross(white, wing2), missing) @ lms_from_rgb
    return first, second, separator @ lms_from_rgb


def simulate_held_out(rgb, model, color_type, severity=1.0):
    if not np.isfinite(severity) or not 0 <= severity <= 1:
        raise ValueError("Severity must be between 0 and 1")
    first, second, separator = model_matrices(model, color_type)
    if severity == 0:
        return np.asarray(rgb, np.float32).copy()
    linear = decode_srgb(np.asarray(rgb, np.float64))
    seen = np.where((linear @ separator >= 0)[..., None], linear @ first.T, linear @ second.T)
    return encode_srgb((1 - severity) * linear + severity * seen).astype(np.float32)


def pair_metrics(original_lab, before_lab, after_lab, indices):
    distances = lambda lab: np.linalg.norm(lab.reshape(-1, 3)[indices[:, 0]] - lab.reshape(-1, 3)[indices[:, 1]], axis=1)
    normal, before, after = [distances(lab) for lab in (original_lab, before_lab, after_lab)]
    eligible = normal > 15
    lost = eligible & (before < 0.5 * normal)
    safe = eligible & ~lost
    recovered = lost & (after >= 0.5 * normal)
    collisions = safe & (after < 0.5 * normal)
    count = int(lost.sum())
    safe_count = int(safe.sum())
    return {"lost_pairs": count, "recovered_pairs": int(recovered.sum()),
            "recovery": float(recovered.sum() / count) if count else None,
            "safe_pairs": safe_count, "new_collisions": int(collisions.sum()),
            "new_collision_rate": float(collisions.sum() / safe_count) if safe_count else None,
            "low_count": count < 20}


def boundary_metrics(original_lab, before_lab, after_lab):
    distances = lambda lab: [np.linalg.norm(np.diff(lab, axis=axis), axis=-1) for axis in (0, 1)]
    normal, before, after = [distances(lab) for lab in (original_lab, before_lab, after_lab)]
    lost = [(n >= 5) & (b < 0.6 * n) for n, b in zip(normal, before)]
    count = sum(int(mask.sum()) for mask in lost)
    if not count:
        return {"lost_boundaries": 0, "boundary_visibility": None}
    visibility = sum(float(np.minimum(a[mask] / n[mask], 1).sum()) for n, a, mask in zip(normal, after, lost))
    return {"lost_boundaries": count, "boundary_visibility": visibility / count}
