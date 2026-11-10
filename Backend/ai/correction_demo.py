"""이미지 보정(correction.py) 결과를 눈으로 비교하는 이미지와 색 구분 수치를 만든다. (발표·검증용)

결과 (Backend/data/eval/correction/)
- cvd_<작품>.jpg   : 원본 / 색각이상 사용자에게 보이는 원본 / 보정본 / 색각이상 사용자에게 보이는 보정본
- edge_<작품>.jpg  : 원본 / 선 굵기 edge 0.3·0.6·1.0
- report.md        : 색 차이 보존율 표

구분이 사라진 색 쌍 복원율: 그림에서 무작위로 고른 픽셀 쌍 2만 개 중, 정상 시각에서는 확실히 다른 색
(CIELAB ΔE > 15)인데 색각이상 시뮬레이션에서는 색 차이가 절반 미만으로 줄어드는 쌍을 '구분이 사라진 쌍'으로 본다.
보정 후 시뮬레이션에서 그 쌍의 색 차이가 다시 정상 시각의 절반 이상이 되면 '복원'으로 센다.

실행 (SWAITHON 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\correction_demo.py
"""
import json
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:] = [entry for entry in sys.path if Path(entry or ".").resolve() != Path(__file__).resolve().parent]
sys.path.insert(0, str(BACKEND))

from ai.correction import correct_array, simulate  # noqa: E402

OUT = BACKEND / "data" / "eval" / "correction"
TYPES = {"protan": "적색약", "deutan": "녹색약", "tritan": "청색약"}
# 발표용 비교 이미지를 만들 작품: (작품 파일 이름, 보여줄 색각 유형)
CVD_SHOWCASE = [("nga_farmhouse-in-provence", "deutan"), ("aic_a-mild-breeze-on-a-fine-day", "protan"),
                ("met_ia-orana-maria", "deutan"), ("nga_roses", "protan"),
                ("nga_woman-with-a-parasol", "tritan"), ("met_wheat-field-with-cypresses", "tritan")]
EDGE_SHOWCASE = ["met_melencolia-i", "aic_sudden-shower-over-shin-ohashi-bridge", "nga_the-three-crosses",
                 "nga_symphony-in-white-no-1"]


def load(path, side=1000):
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((side, side))
        return np.asarray(image, dtype=np.float32) / 255


def pair_differences(rgb, pairs):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).reshape(-1, 3)
    return np.linalg.norm(lab[pairs[:, 0]] - lab[pairs[:, 1]], axis=1)


def fmt(value):
    return "-" if value is None else f"{value:.0%}"


def font(size):
    for name in ("malgun.ttf", "C:/Windows/Fonts/malgun.ttf", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sheet(images, labels, path, cell=420):
    canvas = Image.new("RGB", (cell * len(images), cell + 40), "white")
    draw, text_font = ImageDraw.Draw(canvas), font(22)
    for index, (array, label) in enumerate(zip(images, labels)):
        tile = Image.fromarray((np.clip(array, 0, 1) * 255).astype(np.uint8))
        tile.thumbnail((cell - 8, cell - 8))
        canvas.paste(tile, (index * cell + 4, 40))
        draw.text((index * cell + 6, 6), label, fill="black", font=text_font)
    canvas.save(path, quality=88)


def main():
    records = json.loads((BACKEND / "catalog.artworks.json").read_text(encoding="utf-8"))
    paths = {Path(record["image_path"]).stem: BACKEND / record["image_path"] for record in records}
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20261111)

    rows = []
    for stem, path in paths.items():
        rgb = load(path, 512)
        pairs = rng.integers(0, rgb.shape[0] * rgb.shape[1], size=(20000, 2))
        normal = pair_differences(rgb, pairs)
        row = {"artwork": stem}
        for color_type in TYPES:
            seen = pair_differences(simulate(rgb, color_type, 1.0), pairs)
            corrected = correct_array(rgb, {"color_type": color_type, "severity": 1.0})
            seen_after = pair_differences(simulate(corrected, color_type, 1.0), pairs)
            lost = (normal > 15) & (seen < 0.5 * normal)
            recovered = float((seen_after[lost] >= 0.5 * normal[lost]).mean()) if lost.sum() >= 20 else None
            row[color_type] = (round(float(lost.mean()), 4), None if recovered is None else round(recovered, 3))
        rows.append(row)
        print(f"{stem}: " + ", ".join(f"{TYPES[t]} 사라진 쌍 {row[t][0]:.1%} → 복원 {fmt(row[t][1])}" for t in TYPES))

    for stem, color_type in CVD_SHOWCASE:
        rgb = load(paths[stem])
        corrected = correct_array(rgb, {"color_type": color_type, "severity": 1.0})
        name = TYPES[color_type]
        sheet([rgb, simulate(rgb, color_type, 1.0), corrected, simulate(corrected, color_type, 1.0)],
              ["원본", f"{name}에게 보이는 원본", "보정본", f"{name}에게 보이는 보정본"], OUT / f"cvd_{stem}.jpg")
    for stem in EDGE_SHOWCASE:
        rgb = load(paths[stem])
        sheet([rgb] + [correct_array(rgb, {"edge": value}) for value in (0.3, 0.6, 1.0)],
              ["원본", "선 굵기 0.3", "선 굵기 0.6", "선 굵기 1.0"], OUT / f"edge_{stem}.jpg")

    lines = ["# 이미지 보정 검증 보고서", "",
             "색각이상 시뮬레이션: Machado(2009), 정도 1.0. 그림마다 무작위 픽셀 쌍 2만 개(CIELAB ΔE)로 계산.",
             "- 사라진 쌍: 정상 시각에서는 확실히 다른 색(ΔE > 15)인데 색각이상 시뮬레이션에서 색 차이가 절반 미만인 쌍의 비율",
             "- 복원율: 그 쌍 중 보정 후 시뮬레이션에서 색 차이가 정상 시각의 절반 이상으로 돌아온 비율 (사라진 쌍이 20개 미만이면 -)", "",
             "| 작품 | " + " | ".join(f"{name} 사라진 쌍 / 복원율" for name in TYPES.values()) + " |",
             "|---|" + "---|" * len(TYPES)]
    for row in rows:
        lines.append(f"| {row['artwork']} | " + " | ".join(f"{row[t][0]:.1%} / {fmt(row[t][1])}" for t in TYPES) + " |")
    averages = {t: np.mean([row[t][1] for row in rows if row[t][1] is not None]) for t in TYPES}
    counts = {t: sum(row[t][1] is not None for row in rows) for t in TYPES}
    lines.append("| **평균 복원율** | " + " | ".join(f"**{averages[t]:.0%}** ({counts[t]}점)" for t in TYPES) + " |")
    lines += ["", "비교 이미지: `cvd_*.jpg`(색각 보정), `edge_*.jpg`(선 굵기)", ""]
    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n평균 복원율: " + ", ".join(f"{TYPES[t]} {averages[t]:.0%} ({counts[t]}점)" for t in TYPES))
    print(f"결과 폴더: {OUT}")


if __name__ == "__main__":
    main()
