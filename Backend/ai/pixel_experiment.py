"""Evaluate frozen v2 on 21 regression artworks, 12 new artworks and 15 plates."""
import argparse
from dataclasses import asdict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
from time import perf_counter

import numpy as np
from PIL import Image

from .calibration_assets import PLATE_NUMBERS, PLATE_SEED
from .correction import correct_array
from .palette_correction import image_lab, mean_change
from .palette_evaluation import MODELS, TYPES, pair_metrics, simulate_held_out
from .palette_experiment import load_artwork, metric_size, panel, save_rgb, write_csv
from .pixel_correction import PixelConfig, correct_pixels
from .plates import make_plate


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/experiments/palette-v2"
PAIR_SEED = 20261113
STRENGTHS = (.2, .6, 1.)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fast_artwork_metrics(original, baseline, candidate, color, count=30000):
    images = [metric_size(image) for image in (original, baseline, candidate)]
    pairs = np.random.default_rng(PAIR_SEED).integers(0, images[0].shape[0] * images[0].shape[1], size=(count, 2))
    samples = [image.reshape(-1, 3)[pairs.reshape(-1)][None] for image in images]
    normal_lab = image_lab(samples[0])
    indices = np.arange(2 * count).reshape(count, 2)
    result = []
    for model in MODELS:
        before, a, b = [image_lab(simulate_held_out(sample, model, color)) for sample in samples]
        result.append({"model": model, "baseline": pair_metrics(normal_lab, before, a, indices),
                       "candidate": pair_metrics(normal_lab, before, b, indices)})
    return result


def fast_number_contrast(image, dots, model, color):
    pixels = np.array([image[int(y), int(x)] for x, y, _ in dots], np.float32)[None]
    seen = image_lab(simulate_held_out(pixels, model, color))[0]
    figure = np.array([bool(item[2]) for item in dots])
    return float(np.linalg.norm(seen[figure].mean(axis=0) - seen[~figure].mean(axis=0)))


def summarize(rows):
    summaries = []
    for dataset in ("regression21", "new12"):
        for model in MODELS:
            for color in (*TYPES, "all"):
                selected = [row for row in rows if row["dataset"] == dataset and row["model"] == model and (color == "all" or row["color_type"] == color)]
                item = {"dataset": dataset, "model": model, "color_type": color}
                for method in ("baseline", "candidate"):
                    lost = sum(row[method]["lost_pairs"] for row in selected)
                    recovered = sum(row[method]["recovered_pairs"] for row in selected)
                    safe = sum(row[method]["safe_pairs"] for row in selected)
                    collisions = sum(row[method]["new_collisions"] for row in selected)
                    values = [row[method]["recovery"] for row in selected if row[method]["recovery"] is not None]
                    item[method] = {"lost_pairs": lost, "recovered_pairs": recovered,
                                    "recovery": recovered / lost if lost else None,
                                    "macro_recovery": float(np.mean(values)) if values else None,
                                    "new_collisions": collisions, "safe_pairs": safe,
                                    "new_collision_rate": collisions / safe if safe else None}
                summaries.append(item)
    return summaries


def assessment(result):
    failures = []
    for row in result["summary"]:
        a, b = row["baseline"]["recovery"], row["candidate"]["recovery"]
        passed = a is not None and b is not None and (b > a if row["color_type"] == "all" else b >= a)
        if not passed:
            failures.append(f"{row['dataset']}/{row['model']}/{row['color_type']}")
    plate_summary = []
    for group in ("legacy", "new"):
        for model in MODELS:
            for color in TYPES:
                for strength in STRENGTHS:
                    rows = [r for r in result["plates"] if r["group"] == group and r["model"] == model and r["color_type"] == color and r["strength"] == strength]
                    a, b = [float(np.mean([row[name] for row in rows])) for name in ("baseline_contrast", "candidate_contrast")]
                    plate_summary.append({"group": group, "model": model, "color_type": color, "strength": strength,
                                          "baseline_contrast": a, "candidate_contrast": b, "pass": b >= a - .001})
    over_budget = sum(row["candidate_delta_e"] > row["baseline_delta_e"] + 1e-6 for row in result["timings"])
    timed = [row for row in result["timings"] if row["dataset"] == "regression21"]
    slow = sum(row["candidate_seconds"] > 3 for row in timed)
    checks = {"recovery": not failures, "color_change": not over_budget,
              "plates": all(row["pass"] for row in plate_summary), "runtime": slow == 0}
    return {"checks": checks, "all_pass": all(checks.values()), "recovery_failures": failures,
            "plate_summary": plate_summary, "budget_violations": over_budget,
            "slow_cases": slow, "fallback_cases": sum(not r["diagnostics"]["selected"] for r in result["timings"])}


def pct(value):
    return "해당 쌍 없음" if value is None else f"{100 * value:.2f}%"


def report(result, path, out):
    rel = lambda target: Path(os.path.relpath(target, path.parent)).as_posix()
    decision = result["assessment"]
    checks = decision["checks"]
    headline = "모든 조건 통과" if decision["all_pass"] else "통과하지 못한 조건이 남아 있음"
    lines = ["# 실제 픽셀 쌍을 최적화한 색 보정 v2", "", f"**최종 판정: {headline}.**", "",
             f"평가 시각: {result['created']}", "",
             "[사전 계획](protocol.md) / [설정·코드 해시](frozen.json) / [새 검증 12점 목록](holdout.json)", "",
             "기존 A'에서 출발해, k-means 기반의 부드러운 보정 함수를 실제 픽셀 쌍으로 최적화했다.",
             "최적화와 후보 선택에는 Machado만 사용했다. 아래 네 설정은 최종 평가에만 사용했다.",
             "조건을 통과하지 못한 그림은 A' 그대로 반환하며 복귀율도 공개한다.", "",
             "## 고정 조건 결과", "", "| 조건 | 결과 |", "|---|---|"]
    for key, label in (("recovery", "두 자료 집단의 모델별 전체 회복률 상승·유형별 하락 없음"),
                       ("color_change", "모든 입력의 평균 색 변화 A' 이하"),
                       ("plates", "기존/추가 검사판 대비 유지"), ("runtime", "1000px 보정 최대 3초 이내")):
        lines.append(f"| {label} | {'통과' if checks[key] else '실패'} |")
    lines += ["", f"- 회복률 조건 실패: {', '.join(decision['recovery_failures']) or '없음'}",
              f"- A' 복귀 {decision['fallback_cases']}/{len(result['timings'])}건. 색 변화 초과 {decision['budget_violations']}건.",
              f"- 3초 초과 {decision['slow_cases']}/63건. 검사판 평균 하락 {sum(not r['pass'] for r in decision['plate_summary'])}/72셀.", "",
              "## 구분 회복률", "",
              "회복률은 시뮬레이션에서 사라진 픽셀 쌍 중 정상 색 차이의 절반 이상을 회복한 비율이다.",
              "작품당 같은 무작위 쌍 30,000개를 사용하고, 회복 수/손실 수를 합산했다.",
              "기존 21점은 이미 v1에서 관찰한 회귀 비교이며, 새 12점은 이번 색 보정의 별도 검증이다.", "",
              "| 자료 | 모델 | 유형 | A' | v2 | 차이(%p) | A'→v2 새 충돌률 |", "|---|---|---|---:|---:|---:|---:|"]
    for row in result["summary"]:
        a, b = row["baseline"], row["candidate"]
        diff = "-" if a["recovery"] is None else f"{100 * (b['recovery'] - a['recovery']):+.2f}"
        lines.append(f"| {row['dataset']} | {row['model']} | {row['color_type']} | {pct(a['recovery'])} | {pct(b['recovery'])} | {diff} | {pct(a['new_collision_rate'])} → {pct(b['new_collision_rate'])} |")
    lines += ["", "## 색 변화·시간", "", "| 자료 | 평균 ΔE A' | 평균 ΔE v2 | 시간 중앙값 A'/v2(초) | 시간 최대 A'/v2(초) |", "|---|---:|---:|---:|---:|"]
    for dataset in ("regression21", "new12"):
        rows = [row for row in result["timings"] if row["dataset"] == dataset]
        lines.append(f"| {dataset} | {np.mean([r['baseline_delta_e'] for r in rows]):.4f} | {np.mean([r['candidate_delta_e'] for r in rows]):.4f} | "
                     f"{np.median([r['baseline_seconds'] for r in rows]):.3f}/{np.median([r['candidate_seconds'] for r in rows]):.3f} | "
                     f"{max(r['baseline_seconds'] for r in rows):.3f}/{max(r['candidate_seconds'] for r in rows):.3f} |")
    lines += ["", "기존 21점은 최대 1000px, 새 12점은 보유 원본의 최대 512px이다. 서로 다른 해상도의 시간을 섞지 않았다.",
              "RGB 배열 보정 시간이며 v2는 A' 계산, 군집화, 최적화와 예산 검증을 포함한다. 파일/JPEG/최종 평가는 제외한다.",
              "단일 실행 측정이며 코드, 입력, 설정을 고정하여 기록했다.", "",
              "## 검사판", "", "| 자료 | 모델 | 유형 | 세기 | A' ΔE | v2 ΔE | 판정 |", "|---|---|---|---:|---:|---:|---|"]
    for row in decision["plate_summary"]:
        lines.append(f"| {row['group']} | {row['model']} | {row['color_type']} | {row['strength']:.1f} | {row['baseline_contrast']:.3f} | {row['candidate_contrast']:.3f} | {'통과' if row['pass'] else '실패'} |")
    lines += ["", "## 왜 v1을 바꿨나", "",
              "v1은 대표색 목적값을 줄여도 실제 픽셀 쌍을 회복하지 못했다. v2는 실제 픽셀 출력을 통해",
              "최적화하고 A'를 출발점으로 보존한다. 자체 검증에 실패하면 A'로 돌아간다.",
              "자체 검증은 Machado 기준이므로, 다른 관찰자 모델에서도 개별 그림의 무하락을 보장하지는 않는다.", "",
              "## 원자료와 한계", "",
              f"- [전체 JSON]({rel(out / 'results.json')}) / [작품 CSV]({rel(out / 'artworks.csv')}) / [검사판 CSV]({rel(out / 'plates.csv')})",
              f"- [전체 비교 사진]({rel(out / 'panels')})",
              "- 새 12점은 기존 작품 인식 모델의 학습 자료에서 가져왔지만 색 보정의 조정·v1 검증에는 쓰지 않았다.",
              "- 대표색/함수는 이미지마다 계산한다. 신경망 재학습이 아니다.",
              "- 네 평가 설정은 같은 원뿔 투영 계열이다. Viénot의 청색약, HPE, CRT 기반 Vischeck의 한계는 남는다.",
              "- 실제 사용자 실험/진단 정확도나 앱 사용성 향상을 증명하지 않는다. 앱에는 아직 연결하지 않았다.",
              "- 색 변화는 평균 ΔE76이며 일부 국소 색 변화가 클 수 있다. 비교 사진의 시각 점검도 필요하다.", "",
              "재현: 저장소 루트에서 `Backend/.venv/Scripts/python.exe -m Backend.ai.pixel_experiment --out Backend/data/eval/pixel-v2-reproduction --report Backend/data/eval/pixel-v2-reproduction/report.md`.", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def compare(rgb, color, strength, config):
    start = perf_counter()
    baseline = correct_array(rgb, {"color_type": color, "severity": strength})
    baseline_seconds = perf_counter() - start
    start = perf_counter()
    candidate, diagnostics = correct_pixels(rgb, color, strength, baseline=baseline, config=config)
    candidate_seconds = baseline_seconds + perf_counter() - start
    return baseline, candidate, {"baseline_seconds": baseline_seconds, "candidate_seconds": candidate_seconds,
                                  "baseline_delta_e": mean_change(rgb, baseline), "candidate_delta_e": mean_change(rgb, candidate),
                                  "diagnostics": diagnostics}


def run(out, report_path):
    if out.exists():
        raise FileExistsError("Use a new output directory to preserve every result")
    config = PixelConfig()
    frozen_path = DOCS / "frozen.json"
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen["config"] != asdict(config):
        raise ValueError("Configuration differs from the frozen development result")
    hashes = frozen["source_sha256"]
    if any(sha(ROOT / name) != value for name, value in hashes.items()):
        raise ValueError("Frozen source code has changed")
    records = json.loads((ROOT / "Backend/catalog.artworks.json").read_text(encoding="utf-8"))
    holdout = json.loads((DOCS / "holdout.json").read_text(encoding="utf-8"))
    dataset = [{"dataset": "regression21", "id": r["id"], "title": r["title"], "path": "Backend/" + r["image_path"]} for r in records]
    dataset += [{"dataset": "new12", "id": "nga-new-" + r["object_id"], "title": r["title"], "path": r["path"], "sha256": r["sha256"]} for r in holdout["artworks"]]
    for row in dataset:
        value = sha(ROOT / row["path"])
        if row.get("sha256", value) != value:
            raise ValueError("Held-out image has changed")
        row["sha256"] = value
    out.mkdir(parents=True)
    (out / "panels").mkdir()
    (out / "plates").mkdir()
    result = {"created": datetime.now().astimezone().isoformat(), "frozen_sha256": sha(frozen_path),
              "frozen": frozen, "dataset": dataset, "timings": [], "artworks": [], "plates": [],
              "environment": {"python": sys.version.split()[0], "numpy": np.__version__, "platform": platform.platform()}}
    warm = np.random.default_rng(17).uniform(.15, .8, (32, 32, 3)).astype(np.float32)
    compare(warm, "deutan", 1, config)
    for index, record in enumerate(dataset, 1):
        rgb = load_artwork(ROOT / record["path"])
        for color in TYPES:
            a, b, timing = compare(rgb, color, 1, config)
            result["timings"].append({"dataset": record["dataset"], "artwork": record["id"], "color_type": color,
                                      "width": rgb.shape[1], "height": rgb.shape[0], **timing})
            for row in fast_artwork_metrics(rgb, a, b, color):
                result["artworks"].append({"dataset": record["dataset"], "artwork": record["id"], "color_type": color, **row})
            panel(*(metric_size(x, 360) for x in (rgb, a, b)), color, f"{record['title']} · {color}", out / "panels" / f"{record['id']}-{color}.jpg")
            print(f"ART {index}/33 {record['id']} {color}: selected={timing['diagnostics']['selected']} {timing['candidate_seconds']:.3f}s", flush=True)
        (out / "checkpoint.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    for color in TYPES:
        for plate_index, number in enumerate([*PLATE_NUMBERS[color][:4], {"protan": 61, "deutan": 47, "tritan": 82}[color]]):
            group = "legacy" if plate_index < 4 else "new"
            seed = PLATE_SEED[color] + plate_index if group == "legacy" else {"protan": 9101, "deutan": 9202, "tritan": 9303}[color]
            stem = f"{color}-{number}-{seed}"
            if group == "legacy":
                folder = ROOT / "Backend/data/eval/palette-v1/plates"
                with Image.open(folder / f"{stem}-original.png") as source:
                    rgb = np.asarray(source.convert("RGB"), np.float32) / 255
                dots = json.loads((folder / f"{stem}-dots.json").read_text(encoding="utf-8"))["dots"]
            else:
                rgb, dots = make_plate(color, number, seed, 720)
            save_rgb(rgb, out / "plates" / f"{stem}-original.png")
            (out / "plates" / f"{stem}-dots.json").write_text(json.dumps(dots), encoding="utf-8")
            for strength in STRENGTHS:
                a, b, timing = compare(rgb, color, strength, config)
                for model in MODELS:
                    values = [fast_number_contrast(x, dots, model, color) for x in (rgb, a, b)]
                    result["plates"].append({"group": group, "plate": stem, "color_type": color, "strength": strength, "model": model,
                                              "original_contrast": values[0], "baseline_contrast": values[1], "candidate_contrast": values[2],
                                              "selected": timing["diagnostics"]["selected"], "reason": timing["diagnostics"]["reason"]})
                if strength == 1:
                    panel(*(metric_size(x, 360) for x in (rgb, a, b)), color, f"{group} · {color} · {number}", out / "panels" / f"plate-{stem}.jpg")
            print(f"PLATE {color} {plate_index+1}/5 complete", flush=True)
    if any(sha(ROOT / name) != value for name, value in hashes.items()):
        raise RuntimeError("Source code changed while measuring")
    result["summary"] = summarize(result["artworks"])
    result["assessment"] = assessment(result)
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    flattened = []
    for row in result["artworks"]:
        flat = {key: row[key] for key in ("dataset", "artwork", "color_type", "model")}
        for method in ("baseline", "candidate"):
            flat.update({f"{method}_{key}": value for key, value in row[method].items()})
        flattened.append(flat)
    write_csv(out / "artworks.csv", flattened)
    write_csv(out / "plates.csv", result["plates"])
    report(result, report_path, out)
    print(json.dumps({"checks": result["assessment"]["checks"], "report": str(report_path)}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "Backend/data/eval/pixel-v2")
    parser.add_argument("--report", type=Path, default=DOCS / "report.md")
    args = parser.parse_args()
    run(args.out.resolve(), args.report.resolve())


if __name__ == "__main__":
    main()
