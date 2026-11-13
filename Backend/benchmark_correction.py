"""Time the real server JPEG pipeline; stop after the first case over 3s.

Run from the repository root with ``python -m Backend.benchmark_correction
--image PATH --output REPORT.json``. This module never loads dotenv files.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import platform
from time import perf_counter
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageOps

from .ai import local_native, server_cluster
from .ai.correction import correct_image
from .ai.profile import AIProfile
from .ai_routes import correct_jpeg
from .images import normalize_image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.image.read_bytes()
    # Preparing a second input is outside the timer, as is reading the original
    # file. Both cases still include server decoding, normalization and encoding.
    with Image.open(BytesIO(source)) as opened, ImageOps.exif_transpose(opened) as oriented:
        with oriented.convert("RGB") as small:
            small.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            small.save(buffer, format="JPEG", quality=92)
    report = {
        "at_utc": datetime.now(timezone.utc).isoformat(),
        "source": str(args.image), "source_sha256": sha256(source).hexdigest(),
        "mode": "cluster", "limit_seconds": 3.0, "stopped": False,
        "scope": "input normalization + correct_image + output validation/normalization; no disk/network/DB time",
        "startup": "modules imported; native tables initialized on the first timed call; no warmup",
        "python": platform.python_version(), "cpu": platform.processor(),
        "numpy": np.__version__, "opencv": cv2.__version__, "opencv_threads": cv2.getNumThreads(),
        "thread_environment": {name: os.environ.get(name) for name in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")},
        "native": local_native.available(), "cases": [],
    }
    prepare = server_cluster.prepare_plan
    with patch.dict(os.environ, {"COLOR_CORRECTION_MODE": "cluster"}):
        for label, content in (("1280px input", buffer.getvalue()), ("original input", source)):
            for color in ("protan", "deutan"):
                plans, core_times = [], []

                def observe_plan(*values, **kwargs):
                    plan, corrected = prepare(*values, **kwargs)
                    plans.append({"analysis_shape": plan.analysis_shape, "reason": plan.reason})
                    return plan, corrected

                def timed_corrector(jpeg, profile):
                    started = perf_counter()
                    result = correct_image(jpeg, profile)
                    core_times.append(perf_counter() - started)
                    return result

                profile = AIProfile(color_type=color, severity=1, edge=0)
                with patch.object(server_cluster, "prepare_plan", side_effect=observe_plan):
                    started = perf_counter()
                    normalized = normalize_image(content)
                    result = correct_jpeg(normalized.content, profile, timed_corrector)
                    elapsed = perf_counter() - started
                case = {"input": label, "width": normalized.width, "height": normalized.height,
                        "color": color, "severity": 1, "seconds": elapsed,
                        "core_seconds": core_times[0], "plans": plans,
                        "output_bytes": len(result), "output_sha256": sha256(result).hexdigest()}
                report["cases"].append(case)
                print(json.dumps(case), flush=True)
                if elapsed > report["limit_seconds"]:
                    report["stopped"] = True
                    break
            if report["stopped"]:
                break
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 2 if report["stopped"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
