"""Optional, reproducibly built C kernel for experimental full-image mapping.

Build explicitly with ``python -m Backend.ai.local_native`` before benchmarks.
No compilation, compiler search, or global thread changes occur on import.
"""
import argparse
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
from threading import RLock

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("native") / "local_map.c"
FLAGS = ("-O3", "-std=c11", "-ffp-contract=off", "-shared")
_kernel = None
_library = None
_partner = None
_objective = None
_initialization_lock = RLock()


def library_path():
    digest = hashlib.sha256(SOURCE.read_bytes() + repr(FLAGS).encode()).hexdigest()[:20]
    extension = ".dll" if os.name == "nt" else ".so"
    return ROOT / "Backend/data/native" / f"local-map-{digest}{extension}"


def build(compiler=None):
    output = library_path()
    if output.exists():
        return output
    executable = compiler or shutil.which("gcc")
    if not executable:
        raise RuntimeError("gcc is needed to build the optional experiment kernel")
    output.parent.mkdir(parents=True, exist_ok=True)
    platform_flags = ["-static-libgcc"] if os.name == "nt" else ["-fPIC", "-lm"]
    subprocess.run([executable, *FLAGS, str(SOURCE), *platform_flags, "-o", str(output)], check=True)
    return output


def available():
    return library_path().exists()


def _load_library():
    global _library
    if _library is None:
        with _initialization_lock:
            if _library is None:
                library = ctypes.CDLL(str(library_path()))
                initialize = library.initialize_tables
                initialize.argtypes = []
                initialize.restype = None
                initialize()
                # Initialization releases the GIL. Publish only once the
                # shared read-only transfer tables are ready for all requests.
                _library = library
    return _library


def color_partners(normal, seen, share, minimum, ratio):
    global _partner
    if _partner is None:
        with _initialization_lock:
            if _partner is None:
                function = _load_library().color_partners
                array32 = np.ctypeslib.ndpointer(dtype=np.float32, flags="C_CONTIGUOUS")
                array64 = np.ctypeslib.ndpointer(dtype=np.float64, flags="C_CONTIGUOUS")
                function.argtypes = [array32, array32, array64, array64, ctypes.c_size_t, ctypes.c_float, ctypes.c_float]
                function.restype = None
                _partner = function
    normal, seen = (np.ascontiguousarray(x, np.float32) for x in (normal, seen))
    share = np.ascontiguousarray(share, np.float64)
    if normal.ndim != 2 or normal.shape[1] != 3 or normal.shape != seen.shape or share.shape != (len(normal),):
        raise ValueError("Color arrays and shares must have matching lengths")
    if not all(np.isfinite(x).all() for x in (normal, seen, share)):
        raise ValueError("Color arrays and shares must be finite")
    output = np.zeros_like(share)
    _partner(normal, seen, share, output, len(normal), minimum, ratio)
    return output


def make_objective(original_lab, baseline_lab, weights, matrix, pairs, normal,
                   lost_weights, safe_weights, target, config, budget):
    """Allocate private workspace per fit; coefficients never cross requests."""
    global _objective
    if _objective is None:
        with _initialization_lock:
            if _objective is None:
                function = _load_library().refine_objective
                array = np.ctypeslib.ndpointer(dtype=np.float64, flags="C_CONTIGUOUS")
                integer = np.ctypeslib.ndpointer(dtype=np.int64, flags="C_CONTIGUOUS")
                function.argtypes = [array] * 4 + [integer] + [array] * 7 + [ctypes.c_size_t] * 3 + [ctypes.c_double] * 5
                function.restype = ctypes.c_double
                _objective = function
    arrays = [np.ascontiguousarray(a, np.float64) for a in
              (original_lab, baseline_lab, weights, matrix, normal, lost_weights, safe_weights, target)]
    original_lab, baseline_lab, weights, matrix, normal, lost_weights, safe_weights, target = arrays
    pairs = np.ascontiguousarray(pairs, np.int64)
    if weights.ndim != 2 or weights.shape[0] == 0 or weights.shape[1] == 0:
        raise ValueError("Expected a nonempty pixel by cluster weight matrix")
    count, clusters = weights.shape
    if original_lab.shape != (count, 3) or baseline_lab.shape != (count, 3) or matrix.shape != (3, 3):
        raise ValueError("Invalid color or simulation matrix shape")
    if pairs.ndim != 2 or pairs.shape[1] != 2 or not len(pairs) or pairs.min() < 0 or pairs.max() >= count:
        raise ValueError("Pair indices must refer to sampled pixels")
    if any(a.shape != (len(pairs),) for a in (normal, lost_weights, safe_weights, target)):
        raise ValueError("Every pair needs a distance, weight and target")
    if not all(np.isfinite(a).all() for a in arrays) or (normal <= 0).any():
        raise ValueError("Objective arrays must be finite with positive normal distances")
    workspace = np.empty((count, 36), np.float64)

    def objective(parameters):
        parameters = np.ascontiguousarray(parameters, np.float64)
        if parameters.shape != (clusters, 3):
            raise ValueError("Expected one Lab offset per color cluster")
        gradient = np.empty_like(parameters)
        loss = _objective(original_lab, baseline_lab, weights, matrix, pairs, normal, lost_weights,
                          safe_weights, target, parameters, gradient, workspace, count, clusters, len(pairs),
                          config.target_ratio, config.logistic_slope, config.protection, config.regularization, budget)
        return loss, gradient

    return objective


def map_local(source, baseline, cube):
    global _kernel
    if _kernel is None:
        with _initialization_lock:
            if _kernel is None:
                function = _load_library().map_local
                array = np.ctypeslib.ndpointer(dtype=np.float32, flags="C_CONTIGUOUS")
                function.argtypes = [array, array, array, array, ctypes.c_size_t, ctypes.c_int]
                function.restype = None
                _kernel = function  # ctypes retains its library through the function.
    source = np.ascontiguousarray(source, np.float32)
    baseline = np.ascontiguousarray(baseline, np.float32)
    cube = np.ascontiguousarray(cube, np.float32)
    if source.ndim != 3 or source.shape[-1] != 3 or source.shape != baseline.shape:
        raise ValueError("source and baseline must be matching H x W x 3 arrays")
    if cube.ndim != 4 or cube.shape[-1] != 3 or cube.shape[0] < 2 or len(set(cube.shape[:3])) != 1:
        raise ValueError("Expected a cubic RGB LUT with three output channels")
    if not all(np.isfinite(x).all() for x in (source, baseline, cube)):
        raise ValueError("Native kernel requires finite inputs")
    output = np.empty_like(source)
    _kernel(source, baseline, cube, output, source.shape[0] * source.shape[1], cube.shape[0])
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler")
    print(build(parser.parse_args().compiler))
