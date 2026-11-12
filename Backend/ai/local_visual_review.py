"""Create reproducible 1:1 crops and v2 comparisons after frozen v3 evaluation.

This script never changes the fitted method or selects its coefficients.
Run only after local_experiment has completed, outside runtime measurement.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .correction import correct_array
from .palette_correction import image_lab
from .palette_evaluation import TYPES, simulate_held_out
from .palette_experiment import font, load_artwork
from .pixel_correction import correct_pixels


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "Backend/data/eval/pixel-v3"


def crop_panel(arrays, color, box, title, path):
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    margin, label, header = 12, 30, 48
    cell = max(width + 2 * margin, 260)
    canvas = Image.new("RGB", (cell * 4, header + 2 * (height + label + margin)), "#f4f4f4")
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 7), f"{title} · 평가 입력 1:1 · ({left},{top})–({right},{bottom})", font=font(16), fill="#111")
    names = ["원본", "A' 기존", "v2 평균 제한", "v3 픽셀별 제한"]
    crops = [a[top:bottom, left:right] for a in arrays]
    for row in (0, 1):
        values = crops if row == 0 else [simulate_held_out(a, "brettel", color) for a in crops]
        for col, (name, value) in enumerate(zip(names, values)):
            x, y = col * cell, header + row * (height + label + margin)
            draw.text((x + margin, y), name + (" · Brettel" if row else ""), font=font(16), fill="#111")
            tile = Image.fromarray(np.round(np.clip(value, 0, 1) * 255).astype(np.uint8))
            canvas.paste(tile, (x + (cell - width) // 2, y + label))
    canvas.save(path)


def main(out=OUT):
    cv2.setNumThreads(1)
    result = json.loads((out / "results.json").read_text(encoding="utf-8"))
    qa = out / "local-review"
    qa.mkdir(exist_ok=True)
    metrics = []
    examples = [
        ("nga-02", "tritan", "장미 잎·꽃 그늘", [(420, 260, 770, 560), (180, 410, 480, 700)]),
        ("nga-new-46506", "deutan", "아기 얼굴·손", [(80, 140, 287, 330), (160, 370, 320, 485)]),
    ]
    for name, color, title, boxes in examples:
        record = next(r for r in result["dataset"] if r["id"] == name)
        original = load_artwork(ROOT / record["path"])
        baseline = correct_array(original, {"color_type": color, "severity": 1.})
        v2, _ = correct_pixels(original, color, baseline=baseline)
        v3 = np.load(out / "selected" / f"{name}-{color}-v3.npy")
        changes = [np.linalg.norm(image_lab(a) - image_lab(original), axis=-1) for a in (baseline, v2, v3)]
        for method, change in zip(("baseline", "v2", "v3"), changes):
            metrics.append({"artwork": name, "color_type": color, "region": "full", "method": method,
                            "mean": float(change.mean()), "p95": float(np.percentile(change, 95)),
                            "p99": float(np.percentile(change, 99)), "max": float(change.max()),
                            "above_baseline_plus_2": int((change.astype(float) - changes[0] > 2.).sum())})
        for index, box in enumerate(boxes, 1):
            crop_panel([original, baseline, v2, v3], color, box, title, qa / f"{name}-{color}-crop{index}.png")
            left, top, right, bottom = box
            for method, change in zip(("baseline", "v2", "v3"), changes):
                area = change[top:bottom, left:right]
                metrics.append({"artwork": name, "color_type": color, "region": f"crop{index}", "method": method,
                                "mean": float(area.mean()), "p95": float(np.percentile(area, 95)),
                                "p99": float(np.percentile(area, 99)), "max": float(area.max())})
        print(f"Crops complete: {name} {color}", flush=True)
    (qa / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    for color in TYPES:
        columns, tile_width, tile_height = 5, 300, 260
        rows = (len(result["dataset"]) + columns - 1) // columns
        sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "white")
        draw = ImageDraw.Draw(sheet)
        for index, record in enumerate(result["dataset"]):
            x, y = index % columns * tile_width, index // columns * tile_height
            with Image.open(out / "panels" / f"{record['id']}-{color}.jpg") as source:
                tile = source.copy()
                tile.thumbnail((tile_width, tile_height - 20), Image.Resampling.LANCZOS)
                sheet.paste(tile, (x, y + 20))
            draw.text((x + 5, y), record["id"], font=font(12), fill="black")
        sheet.save(out / "panels" / f"overview-{color}.jpg", quality=92)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    main(parser.parse_args().out.resolve())
