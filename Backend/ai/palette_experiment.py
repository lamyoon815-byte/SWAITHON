r"""Reproduce the predeclared 21-artwork / 12-plate palette experiment.

From the repository root:
  Backend\.venv\Scripts\python.exe -m Backend.ai.palette_experiment
Results are local experimental artifacts; no API or frontend assets are changed.
"""
import argparse
import csv
from dataclasses import asdict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
from time import perf_counter

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version

from .calibration_assets import PLATE_NUMBERS, PLATE_SEED
from .correction import correct_array
from .palette_correction import PaletteConfig, correct_palette, image_lab, mean_change
from .palette_evaluation import MODELS, TYPES, boundary_metrics, pair_metrics, simulate_held_out
from .plates import make_plate, number_contrast


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "Backend"
PROTOCOL = ROOT / "docs/experiments/palette-correction/protocol.md"
STRENGTHS = (0.2, 0.6, 1.0)
PAIR_SEED = 20261113
PAIR_COUNT = 30000
TIME_LIMIT = 3.0


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metric_size(image, side=600):
    height, width = image.shape[:2]
    ratio = min(1, side / max(height, width))
    if ratio == 1:
        return image
    return cv2.resize(image, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv2.INTER_AREA)


def load_artwork(path):
    with Image.open(path) as source:
        source = source.convert("RGB")
        source.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
        return np.asarray(source, np.float32) / 255


def font(size):
    for name in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def save_rgb(rgb, path):
    Image.fromarray(np.round(np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(path)


def panel(original, baseline, candidate, color, title, path):
    cell, label_height, title_height = 300, 30, 48
    canvas = Image.new("RGB", (3 * cell, title_height + 2 * (cell + label_height)), "#f4f4f4")
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 8), title, font=font(19), fill="#151515")
    images = [original, baseline, candidate]
    images += [simulate_held_out(image, "brettel", color) for image in images]
    labels = ["원본", "A' 기존 보정", "B 군집화 + 최적화", "원본 · Brettel 시각", "A' · Brettel 시각", "B · Brettel 시각"]
    for index, (array, label) in enumerate(zip(images, labels)):
        column, row = index % 3, index // 3
        x, y = column * cell, title_height + row * (cell + label_height)
        draw.text((x + 8, y + 3), label, font=font(16), fill="#202020")
        tile = Image.fromarray(np.round(np.clip(array, 0, 1) * 255).astype(np.uint8))
        tile.thumbnail((cell - 12, cell - 12), Image.Resampling.LANCZOS)
        canvas.paste(tile, (x + (cell - tile.width) // 2, y + label_height + (cell - tile.height) // 2))
    canvas.save(path, quality=92)


def compare(rgb, color, strength, config):
    start = perf_counter()
    baseline = correct_array(rgb, {"color_type": color, "severity": strength})
    baseline_seconds = perf_counter() - start
    # Include obtaining the A' color budget in B's actual method runtime.
    start = perf_counter()
    budget = mean_change(rgb, baseline)
    candidate, diagnostics = correct_palette(rgb, color, strength, budget=budget, config=config)
    candidate_seconds = baseline_seconds + perf_counter() - start
    return baseline, candidate, {"baseline_seconds": baseline_seconds, "candidate_seconds": candidate_seconds,
                                  "baseline_delta_e": budget, "candidate_delta_e": mean_change(rgb, candidate),
                                  "diagnostics": diagnostics}


def evaluate_artwork(rgb, baseline, candidate, color, artwork_id):
    original, a, b = [metric_size(image) for image in (rgb, baseline, candidate)]
    normal_lab = image_lab(original)
    indices = np.random.default_rng(PAIR_SEED).integers(0, original.shape[0] * original.shape[1], size=(PAIR_COUNT, 2))
    rows = []
    for model in MODELS:
        before_lab, a_lab, b_lab = [image_lab(simulate_held_out(image, model, color)) for image in (original, a, b)]
        a_metrics = pair_metrics(normal_lab, before_lab, a_lab, indices)
        b_metrics = pair_metrics(normal_lab, before_lab, b_lab, indices)
        a_metrics.update(boundary_metrics(normal_lab, before_lab, a_lab))
        b_metrics.update(boundary_metrics(normal_lab, before_lab, b_lab))
        if a_metrics["lost_pairs"] != b_metrics["lost_pairs"]:
            raise AssertionError("Both methods must use the same original lost pairs")
        rows.append({"artwork": artwork_id, "color_type": color, "model": model, "baseline": a_metrics, "candidate": b_metrics})
    return rows


def aggregate(rows):
    summaries = []
    for model in MODELS:
        for color in (*TYPES, "all"):
            group = [row for row in rows if row["model"] == model and (color == "all" or row["color_type"] == color)]
            summary = {"model": model, "color_type": color, "artworks": len(group)}
            for method in ("baseline", "candidate"):
                lost = sum(row[method]["lost_pairs"] for row in group)
                recovered = sum(row[method]["recovered_pairs"] for row in group)
                safe = sum(row[method]["safe_pairs"] for row in group)
                collisions = sum(row[method]["new_collisions"] for row in group)
                values = [row[method]["recovery"] for row in group if row[method]["recovery"] is not None]
                boundaries = sum(row[method]["lost_boundaries"] for row in group)
                boundary_sum = sum((row[method]["boundary_visibility"] or 0) * row[method]["lost_boundaries"] for row in group)
                summary[method] = {"lost_pairs": lost, "recovered_pairs": recovered,
                                   "micro_recovery": recovered / lost if lost else None,
                                   "macro_recovery": float(np.mean(values)) if values else None,
                                   "safe_pairs": safe, "new_collisions": collisions,
                                   "new_collision_rate": collisions / safe if safe else None,
                                   "lost_boundaries": boundaries,
                                   "boundary_visibility": boundary_sum / boundaries if boundaries else None,
                                   "low_count_artworks": sum(row[method]["low_count"] for row in group)}
            summaries.append(summary)
    return summaries


def assess(result):
    recoveries = [row for row in result["summary"] if row["color_type"] != "all"]
    recovery_failures = [f"{row['model']}/{row['color_type']}" for row in recoveries
                         if row["baseline"]["micro_recovery"] is None or row["candidate"]["micro_recovery"] is None
                         or row["candidate"]["micro_recovery"] <= row["baseline"]["micro_recovery"]]
    changes = [row for row in result["timings"] if row["candidate_delta_e"] > row["baseline_delta_e"] + 1e-6]
    plate_summary = []
    for model in MODELS:
        for color in TYPES:
            for strength in STRENGTHS:
                group = [row for row in result["plates"] if row["model"] == model and row["color_type"] == color and row["strength"] == strength]
                a, b = [float(np.mean([row[method] for row in group])) for method in ("baseline_contrast", "candidate_contrast")]
                plate_summary.append({"model": model, "color_type": color, "strength": strength,
                                      "baseline_contrast": a, "candidate_contrast": b,
                                      "individual_drops": sum(row["candidate_contrast"] < row["baseline_contrast"] - 0.001 for row in group),
                                      "pass": b >= a - 0.001})
    slow = [row for row in result["timings"] if row["candidate_seconds"] > TIME_LIMIT]
    checks = {"held_out_recovery": not recovery_failures, "color_change": not changes,
              "plate_contrast": all(row["pass"] for row in plate_summary), "runtime": not slow}
    return {"checks": checks, "numeric_pass": all(checks.values()), "recovery_failures": recovery_failures,
            "color_budget_violations": len(changes), "slow_cases": len(slow),
            "plate_failures": sum(not row["pass"] for row in plate_summary), "plate_summary": plate_summary,
            "visual_review": "pending; see comparison panels"}


def fmt_pct(value):
    return "해당 쌍 없음" if value is None else f"{100 * value:.2f}%"


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def write_report(result, report_path, out):
    relative = lambda path: Path(os.path.relpath(path, report_path.parent)).as_posix()
    decision = result["assessment"]
    lines = ["# 비지도 군집화 + 최적화 색 보정 실험", "",
             "**판정: " + ("수치 조건 통과, 시각 점검 필요" if decision["numeric_pass"] else "이번 설정은 개선되지 않았다") + ".**", "",
             f"실행: {result['created']} / 등록 작품 21점 × 3유형, 검사판 12장 × 3세기.",
             "[사전 고정 계획](protocol.md)에 따라 A'(기존 선택 보정)와 B(k-means + 최적화)를 비교했다.",
             "B는 Machado만으로 최적화했다. 아래 회복률은 최적화에 쓰지 않은 모델에서 잰 시뮬레이션 지표다.", "",
             "## 사전 조건 판정", "", "| 조건 | 결과 |", "|---|---|"]
    labels = {"held_out_recovery": "네 모델·각 유형의 구분 회복률 상승", "color_change": "각 작품·유형의 평균 색 변화 증가 없음",
              "plate_contrast": "검사판 유형·모델·세기별 평균 선명도 유지", "runtime": "1000px 작품 보정 최대 3.0초 이내"}
    for key, label in labels.items():
        lines.append(f"| {label} | {'통과' if decision['checks'][key] else '실패'} |")
    lines += ["", f"- 회복률 기준 실패: {', '.join(decision['recovery_failures']) or '없음'}",
              f"- 색 변화 예산 초과 {decision['color_budget_violations']}건, 검사판 평균 하락 {decision['plate_failures']}/36셀, 시간 초과 {decision['slow_cases']}/63건.",
              "- 색 변화 예산은 방법에 내장된 제약이므로, 색 변화 조건 통과 자체는 성능 향상의 증거가 아니다.", "",
              "## 작품 전체 구분 회복률", "",
              "정상 시각 ΔE > 15, 보정 전 모사에서 차이가 절반 미만인 픽셀 쌍을 고정한다.",
              "보정 뒤 절반 이상이면 회복. 표는 회복 수/손실 쌍 수를 합친 micro 값이다.", "",
              "| 평가 모델 | 유형 | 손실 쌍 수 | A' | B | 차이(%p) | A'→B 새 충돌률 |", "|---|---|---:|---:|---:|---:|---:|"]
    for row in result["summary"]:
        a, b = row["baseline"], row["candidate"]
        difference = "-" if a["micro_recovery"] is None else f"{100 * (b['micro_recovery'] - a['micro_recovery']):+.2f}"
        lines.append(f"| {row['model']} | {row['color_type']} | {a['lost_pairs']} | {fmt_pct(a['micro_recovery'])} | {fmt_pct(b['micro_recovery'])} | {difference} | {fmt_pct(a['new_collision_rate'])} → {fmt_pct(b['new_collision_rate'])} |")
    timings = result["timings"]
    lines += ["", "## 색 변화와 처리 시간", "", "| 항목 | A' | B |", "|---|---:|---:|"]
    for label, key, function in (("작품·유형별 평균 ΔE76의 평균", "delta_e", np.mean),
                                  ("보정 시간 중앙값(초)", "seconds", np.median), ("보정 시간 최대값(초)", "seconds", np.max)):
        a, b = [float(function([row[f"{method}_{key}"] for row in timings])) for method in ("baseline", "candidate")]
        lines.append(f"| {label} | {a:.4f} | {b:.4f} |")
    lines += ["", "긴 변 최대 1000px의 RGB 배열 기준. B 시간에는 A' 계산 및 색 변화 예산 계산이 포함된다.",
              "파일 읽기, 평가 모델 실행, 비교 그림 저장, JPEG 인코딩은 제외했다. 단일 실행으로 반복 측정 분산은 추정하지 않았다.",
              f"환경: Python {result['environment']['python']}, NumPy {result['environment']['numpy']}, OpenCV {result['environment']['opencv']}, {result['environment']['platform']}.", "",
              "## 검사판 숫자 선명도", "",
              "숫자 점과 바탕 점 평균 Lab의 ΔE76이며, 숫자를 읽은 정답률은 아니다. 각 셀은 같은 유형 4장 평균.", "",
              "| 모델 | 유형 | 보정 세기 | A' | B | 하락한 개별 판 수 | 판정 |", "|---|---|---:|---:|---:|---:|---|"]
    for row in decision["plate_summary"]:
        lines.append(f"| {row['model']} | {row['color_type']} | {row['strength']:.1f} | {row['baseline_contrast']:.3f} | {row['candidate_contrast']:.3f} | {row['individual_drops']}/4 | {'통과' if row['pass'] else '실패'} |")
    lines += ["", "## 작품별 결과", "", "Brettel 기준. 다른 모델, 저표본 표시, 인접 경계 지표는 원자료에 모두 포함한다.", "",
              "| 작품 | 유형 | A' 회복률 | B 회복률 | A' ΔE | B ΔE | B 시간(초) | 비교 |", "|---|---|---:|---:|---:|---:|---:|---|"]
    for timing in timings:
        row = next(row for row in result["artworks"] if row["model"] == "brettel" and row["artwork"] == timing["artwork"] and row["color_type"] == timing["color_type"])
        title = next(item["title"] for item in result["dataset"] if item["id"] == timing["artwork"])
        panel_path = out / "panels" / f"{timing['artwork']}-{timing['color_type']}.jpg"
        lines.append(f"| {title} | {timing['color_type']} | {fmt_pct(row['baseline']['recovery'])} | {fmt_pct(row['candidate']['recovery'])} | {timing['baseline_delta_e']:.3f} | {timing['candidate_delta_e']:.3f} | {timing['candidate_seconds']:.3f} | [보기]({relative(panel_path)}) |")
    lines += ["", "## 해석과 한계", "",
              "- k-means는 그림의 대표색을 찾고, 최적화가 색 변경을 정했다. 최적화 목적값 감소와 독립 모델의 회복률 상승은 별개다.",
              "- 대표색 쌍을 개선해도 픽셀의 부드러운 혼합 과정에서 효과가 약해지거나 새로운 충돌이 생길 수 있다.",
              "- 평균 색 변화가 작아도 일부 색은 크게 바뀔 수 있고, 숫자 판의 평균색 차이는 시각적 가독성 전체를 나타내지 않는다.",
              "- 네 평가 설정은 원뿔 투영 이론을 공유한다. Vischeck는 CRT 기반 비교 설정이며 HPE는 원래 색순응용 변환이다.",
              "- Viénot 1999의 청색약 결과는 부정확한 스트레스 비교다. HPE/Vischeck 결과까지 넣는 엄격한 계획을 유지했다.",
              "- 원본 검사판도 Machado가 지우는 방향으로 만들어져 있어, 다른 모델로 재더라도 데이터 생성 단계의 편향이 남는다.",
              "- 실제 색각이상 사용자 평가, 다른 작품 검증, 혼합 색각 유형, 세기별 실제 사용자 관찰은 하지 않았다.",
              "- 기존 앱과 서버의 보정 동작에는 이 실험을 연결하지 않았다.", "",
              "## 재현과 원자료", "",
              "저장소 루트에서 다음을 실행한다. 출력 폴더는 새 경로여야 한다.", "", "```powershell",
              ".\\Backend\\.venv\\Scripts\\python.exe -m Backend.ai.palette_experiment --out Backend/data/eval/palette-v1-reproduction --report Backend/data/eval/palette-v1-reproduction/report.md",
              "```", "",
              f"- [전체 원자료 JSON]({relative(out / 'results.json')}) / [작품별 CSV]({relative(out / 'artworks.csv')}) / [검사판 CSV]({relative(out / 'plates.csv')})",
              f"- [비교 그림 폴더]({relative(out / 'panels')}) / [검사판 원본·점 좌표]({relative(out / 'plates')})",
              f"- 계획 SHA-256: `{result['protocol_sha256']}`",
              "- 코드·원본 이미지 해시는 JSON에 기록했다. 지표는 JPEG 저장 전 float32 배열로 계산했다.", "",
              "참고: [DaltonLens 모델 구현](https://github.com/DaltonLens/DaltonLens-Python/blob/master/daltonlens/simulate.py),",
              "[원뿔 변환과 비교 모델의 한계](https://github.com/DaltonLens/DaltonLens-Python/blob/master/daltonlens/convert.py).", ""]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")


def run(out, report_path):
    if out.exists():
        raise FileExistsError(f"Use a new output directory to preserve measured runs: {out}")
    records = json.loads((BACKEND / "catalog.artworks.json").read_text(encoding="utf-8"))
    if len(records) != 21:
        raise ValueError("The fixed protocol requires exactly 21 registered artworks")
    dataset = [{"id": record["id"], "title": record["title"], "path": record["image_path"],
                "sha256": digest(BACKEND / record["image_path"])} for record in records]
    source_paths = [Path(__file__), Path(__file__).with_name("palette_correction.py"),
                    Path(__file__).with_name("palette_evaluation.py"), Path(__file__).with_name("correction.py"),
                    Path(__file__).with_name("plates.py"), Path(__file__).with_name("calibration_assets.py")]
    source_hashes = {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in source_paths}
    config = PaletteConfig()
    result = {"created": datetime.now().astimezone().isoformat(), "protocol_sha256": digest(PROTOCOL),
              "source_sha256": source_hashes, "config": asdict(config), "dataset": dataset,
              "pair_seed": PAIR_SEED, "pair_count": PAIR_COUNT, "strengths": list(STRENGTHS),
              "environment": {"python": sys.version.split()[0], "numpy": np.__version__, "opencv": cv2.__version__,
                              "pillow": pillow_version, "platform": platform.platform(), "processor": platform.processor(),
                              "opencv_threads": cv2.getNumThreads(), "logical_cpus": os.cpu_count()},
              "timings": [], "artworks": [], "plates": []}
    out.mkdir(parents=True)
    (out / "panels").mkdir()
    (out / "plates").mkdir()
    # No held-out results are used for warm-up or parameter selection.
    warm = np.random.default_rng(17).uniform(0.2, 0.7, (32, 32, 3)).astype(np.float32)
    compare(warm, "deutan", 1.0, config)
    for index, record in enumerate(records, 1):
        rgb = load_artwork(BACKEND / record["image_path"])
        for color in TYPES:
            baseline, candidate, timing = compare(rgb, color, 1.0, config)
            result["timings"].append({"artwork": record["id"], "color_type": color,
                                      "width": rgb.shape[1], "height": rgb.shape[0], **timing})
            result["artworks"].extend(evaluate_artwork(rgb, baseline, candidate, color, record["id"]))
            panel(rgb, baseline, candidate, color, f"{record['title']} · {color}", out / "panels" / f"{record['id']}-{color}.jpg")
            print(f"ART {index:02d}/21 {record['id']} {color}: A' {timing['baseline_seconds']:.3f}s / B {timing['candidate_seconds']:.3f}s", flush=True)
        (out / "checkpoint.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    for color in TYPES:
        for plate_index, number in enumerate(PLATE_NUMBERS[color][:4]):
            seed = PLATE_SEED[color] + plate_index
            rgb, dots = make_plate(color, number, seed, size=720)
            stem = f"{color}-{number}-{seed}"
            save_rgb(rgb, out / "plates" / f"{stem}-original.png")
            (out / "plates" / f"{stem}-dots.json").write_text(json.dumps({"seed": seed, "number": number, "dots": dots}), encoding="utf-8")
            for strength in STRENGTHS:
                baseline, candidate, timing = compare(rgb, color, strength, config)
                for model in MODELS:
                    contrasts = [number_contrast(simulate_held_out(image, model, color), dots) for image in (rgb, baseline, candidate)]
                    result["plates"].append({"plate": stem, "color_type": color, "strength": strength, "model": model,
                                              "original_contrast": contrasts[0], "baseline_contrast": contrasts[1],
                                              "candidate_contrast": contrasts[2], "baseline_delta_e": timing["baseline_delta_e"],
                                              "candidate_delta_e": timing["candidate_delta_e"]})
                suffix = f"{stem}-{strength:.1f}"
                save_rgb(baseline, out / "plates" / f"{suffix}-A.png")
                save_rgb(candidate, out / "plates" / f"{suffix}-B.png")
                panel(rgb, baseline, candidate, color, f"검사판 {number} · {color} · {strength:.1f}", out / "panels" / f"plate-{suffix}.jpg")
            print(f"PLATE {color} {plate_index + 1}/4 complete", flush=True)
            (out / "checkpoint.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    if source_hashes != {name: digest(ROOT / name) for name in source_hashes}:
        raise RuntimeError("Experimental source changed during measurement")
    result["summary"] = aggregate(result["artworks"])
    result["assessment"] = assess(result)
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    flat = []
    for row in result["artworks"]:
        value = {key: row[key] for key in ("artwork", "color_type", "model")}
        for method in ("baseline", "candidate"):
            value.update({f"{method}_{key}": item for key, item in row[method].items()})
        timing = next(item for item in result["timings"] if item["artwork"] == row["artwork"] and item["color_type"] == row["color_type"])
        value.update({key: timing[key] for key in ("baseline_delta_e", "candidate_delta_e", "baseline_seconds", "candidate_seconds")})
        flat.append(value)
    write_csv(out / "artworks.csv", flat)
    write_csv(out / "plates.csv", result["plates"])
    write_report(result, report_path, out)
    print(json.dumps({"checks": result["assessment"]["checks"], "report": str(report_path)}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=BACKEND / "data/eval/palette-v1")
    parser.add_argument("--report", type=Path, default=ROOT / "docs/experiments/palette-correction/report.md")
    args = parser.parse_args()
    run(args.out.resolve(), args.report.resolve())


if __name__ == "__main__":
    main()
