"""Verify identical v2 metrics and benchmark memory-efficient execution.

Launch in a separate process with OPENBLAS_NUM_THREADS=OMP_NUM_THREADS=
MKL_NUM_THREADS=1. OpenCV threads are set to 1 in this benchmark process only.
"""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from .correction import correct_array
from .fast_correction_baseline import correct_pixels_fast, fast_baseline
from .palette_correction import mean_change
from .palette_experiment import load_artwork
from .pixel_correction import correct_pixels
from .pixel_experiment import fast_artwork_metrics


ROOT = Path(__file__).resolve().parents[2]


def main():
    out = ROOT / "Backend/data/eval/pixel-v2-execution"
    if out.exists():
        raise FileExistsError("Execution results already exist")
    source = json.loads((ROOT / "Backend/data/eval/pixel-v2/results.json").read_text(encoding="utf-8"))
    cv2.setNumThreads(1)
    sources = ["Backend/ai/fast_correction_baseline.py", "Backend/ai/pixel_speed.py",
               "docs/experiments/palette-v2/execution-plan.md"]
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources}
    for name, value in source["frozen"]["source_sha256"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != value:
            raise ValueError("The frozen v2 fitting code has changed")
    result = {"created": datetime.now().astimezone().isoformat(), "source_sha256": hashes,
              "reference": "Backend/data/eval/pixel-v2/results.json", "rows": [],
              "opencv_threads": cv2.getNumThreads(),
              "thread_environment": {name: os.environ.get(name) for name in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}}
    out.mkdir(parents=True)
    warm = np.random.default_rng(17).uniform(.15, .8, (32, 32, 3)).astype(np.float32)
    correct_pixels_fast(warm, "deutan")
    for index, record in enumerate(source["dataset"], 1):
        image = load_artwork(ROOT / record["path"])
        for color in ("protan", "deutan", "tritan"):
            original_baseline = correct_array(image, {"color_type": color, "severity": 1})
            start = perf_counter()
            actual, diagnostics = correct_pixels_fast(image, color)
            seconds = perf_counter() - start
            optimized_baseline = fast_baseline(image, color, 1)
            same_baseline = bool(np.array_equal(original_baseline, optimized_baseline))
            reference = next(row for row in source["timings"] if row["artwork"] == record["id"] and row["color_type"] == color)
            delta_e = mean_change(image, actual)
            same_delta_e = abs(delta_e - reference["candidate_delta_e"]) <= 1e-6
            rows = fast_artwork_metrics(image, original_baseline, actual, color)
            same_metrics = True
            for row in rows:
                expected = next(r for r in source["artworks"] if r["artwork"] == record["id"] and r["color_type"] == color and r["model"] == row["model"])
                same_metrics &= row["baseline"] == expected["baseline"] and row["candidate"] == expected["candidate"]
            same_pixels = None
            if (record["id"], color) in (("met-01", "protan"), ("aic-02", "deutan"), ("nga-01", "tritan")):
                slow, _ = correct_pixels(image, color, baseline=original_baseline)
                same_pixels = bool(np.array_equal(actual, slow))
            result["rows"].append({"dataset": record["dataset"], "artwork": record["id"], "color_type": color,
                                    "width": image.shape[1], "height": image.shape[0], "seconds": seconds,
                                    "baseline_bit_identical": same_baseline, "metrics_identical": bool(same_metrics),
                                    "delta_e_identical": same_delta_e, "full_pixels_identical": same_pixels,
                                    "selected": diagnostics["selected"]})
            print(f"EXEC {index}/33 {record['id']} {color} {seconds:.3f}s equal={same_baseline and same_metrics and same_delta_e}", flush=True)
        (out / "checkpoint.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    regression = [row for row in result["rows"] if row["dataset"] == "regression21"]
    result["summary"] = {"all_baselines_bit_identical": all(row["baseline_bit_identical"] for row in result["rows"]),
                         "all_metrics_identical": all(row["metrics_identical"] for row in result["rows"]),
                         "all_delta_e_identical": all(row["delta_e_identical"] for row in result["rows"]),
                         "all_checked_pixels_identical": all(row["full_pixels_identical"] is not False for row in result["rows"]),
                         "median_seconds_1000px": float(np.median([row["seconds"] for row in regression])),
                         "max_seconds_1000px": max(row["seconds"] for row in regression),
                         "over_3_seconds": sum(row["seconds"] > 3 for row in regression)}
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
