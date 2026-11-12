"""One frozen evaluation of v3, including runtime and per-pixel color budgets."""
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

import cv2
import numpy as np
from PIL import Image

from . import local_native
from .correction import correct_array
from .local_correction import LocalConfig, correct_local, efficient_baseline, length
from .palette_correction import image_lab
from .palette_evaluation import MODELS, TYPES
from .palette_experiment import load_artwork, metric_size, panel, save_rgb, write_csv
from .pixel_experiment import fast_artwork_metrics, fast_number_contrast


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/experiments/palette-v3"
DATASETS = ("regression21", "previous12", "fresh12")
STRENGTHS = (.2, .6, 1.)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(rows):
    output = []
    for dataset in DATASETS:
        for model in MODELS:
            for color in (*TYPES, "all"):
                group = [r for r in rows if r["dataset"] == dataset and r["model"] == model and (color == "all" or r["color_type"] == color)]
                row = {"dataset": dataset, "model": model, "color_type": color}
                for method in ("baseline", "candidate"):
                    lost = sum(r[method]["lost_pairs"] for r in group)
                    recovered = sum(r[method]["recovered_pairs"] for r in group)
                    safe = sum(r[method]["safe_pairs"] for r in group)
                    collisions = sum(r[method]["new_collisions"] for r in group)
                    row[method] = {"lost_pairs": lost, "recovered_pairs": recovered,
                                   "recovery": recovered / lost if lost else None,
                                   "safe_pairs": safe, "new_collisions": collisions,
                                   "new_collision_rate": collisions / safe if safe else None}
                output.append(row)
    return output


def color_checks(original, baseline, candidate):
    normal = image_lab(original)
    a = length(image_lab(baseline) - normal)
    b = length(image_lab(candidate) - normal)
    excess = b.astype(float) - a
    return {"baseline_delta_e": float(a.mean()), "candidate_delta_e": float(b.mean()),
            "baseline_p95": float(np.percentile(a, 95)), "candidate_p95": float(np.percentile(b, 95)),
            "baseline_p99": float(np.percentile(a, 99)), "candidate_p99": float(np.percentile(b, 99)),
            "baseline_max_delta_e": float(a.max()), "candidate_max_delta_e": float(b.max()),
            "local_excess_pixels": int((excess > 1e-6).sum()), "max_local_excess": float(max(0., excess.max()))}


def measure(rgb, color, strength=1.):
    start = perf_counter()
    output, info = correct_local(rgb, color, strength)
    elapsed = perf_counter() - start
    start = perf_counter()
    baseline = correct_array(rgb, {"color_type": color, "severity": strength})
    baseline_seconds = perf_counter() - start
    exact = np.array_equal(baseline, efficient_baseline(rgb, color, strength))
    if not exact:
        raise AssertionError("Optimized A' differs from the production baseline")
    return baseline, output, {"candidate_seconds": elapsed, "baseline_seconds": baseline_seconds,
                               "baseline_bit_identical": exact, "output_sha256": hashlib.sha256(output.tobytes()).hexdigest(),
                               **color_checks(rgb, baseline, output), "diagnostics": info}


def assess(result):
    failures = []
    for row in result["summary"]:
        a, b = (row[method]["recovery"] for method in ("baseline", "candidate"))
        if a is None or b is None or (b <= a if row["color_type"] == "all" else b < a):
            failures.append(f"{row['dataset']}/{row['model']}/{row['color_type']}")
    plate_summary = []
    for group in ("legacy", "new"):
        for model in MODELS:
            for color in TYPES:
                for strength in STRENGTHS:
                    selected = [r for r in result["plates"] if r["group"] == group and r["model"] == model and r["color_type"] == color and r["strength"] == strength]
                    a, b = (float(np.mean([r[name] for r in selected])) for name in ("baseline_contrast", "candidate_contrast"))
                    plate_summary.append({"group": group, "model": model, "color_type": color, "strength": strength,
                                          "baseline_contrast": a, "candidate_contrast": b, "pass": b >= a - .001})
    all_colors = result["timings"] + result["plate_timings"]
    timed = [r for r in result["timings"] if r["dataset"] == "regression21"] + result["repeat_timings"]
    checks = {"recovery": not failures,
              "mean_color": all(r["candidate_delta_e"] <= r["baseline_delta_e"] + 1e-6 for r in all_colors),
              "local_color": all(r["local_excess_pixels"] == 0 for r in all_colors),
              "plates": all(r["pass"] for r in plate_summary),
              "runtime": all(r["candidate_seconds"] <= 3. for r in timed),
              "repeat_outputs": all(r["identical"] for r in result["repeat_timings"])}
    return {"checks": checks, "all_pass": all(checks.values()), "recovery_failures": failures,
            "plate_summary": plate_summary, "fallback_cases": sum(not r["diagnostics"]["selected"] for r in result["timings"]),
            "individual_drops": sum(r["candidate"]["recovered_pairs"] < r["baseline"]["recovered_pairs"] for r in result["artworks"]),
            "visual_review": "pending; per-pixel color bound is not a user preference test"}


def report(result, path, out):
    rel = lambda target: Path(os.path.relpath(target, path.parent)).as_posix()
    decision = result["assessment"]
    pct = lambda value: "해당 쌍 없음" if value is None else f"{100 * value:.2f}%"
    lines = ["# 국소 색 변화 제한·처리 시간 검증 v3", "",
             f"수치 조건: **{'전체 통과' if decision['all_pass'] else '미통과 조건 있음'}**. 시각 점검은 아래 별도 기록한다.", "",
             "각 픽셀의 원본 대비 색 변화도 기존 A' 이하로 제한했다. k-means로 만든 부드러운 보정 함수를",
             "그림마다 Machado로 최적화한다. 신경망 재학습이 아니다. 앱은 기존 A'를 유지한다.", "",
             "[사전 계획](protocol.md) / [설정·코드 고정](frozen.json) / [새 12점](holdout.json)", "",
             "## 판정", "", "| 조건 | 결과 |", "|---|---|"]
    for key, label in (("recovery", "모델별 전체 회복률 상승·유형별 하락 없음"), ("mean_color", "평균 색 변화 A' 이하"),
                       ("local_color", "각 픽셀 색 변화 A' 이하"), ("plates", "검사판 그룹 평균 대비 유지"),
                       ("runtime", "1000px 전체·반복 측정 최대 3초"), ("repeat_outputs", "반복 측정 픽셀 결과 동일")):
        lines.append(f"| {label} | {'통과' if decision['checks'][key] else '실패'} |")
    lines += ["", "## 회복률", "",
              "regression21은 기존 21점, previous12는 이미 본 v2 추가 12점으로 둘 다 개발·회귀 자료다.",
              "fresh12만 이번 설정 고정 후 처음 평가한 작품이다. 모든 모델에 같은 30,000쌍을 사용했다.",
              "회복률은 시뮬레이션에서 손실된 색 차이를 정상 차이의 절반 이상으로 회복한 픽셀 쌍의 비율이다.", "",
              "| 자료 | 평가 모델 | 유형 | A' | v3 | 새 충돌률 A'→v3 |", "|---|---|---|---:|---:|---:|"]
    for row in result["summary"]:
        a, b = row["baseline"], row["candidate"]
        lines.append(f"| {row['dataset']} | {row['model']} | {row['color_type']} | {pct(a['recovery'])} | {pct(b['recovery'])} | {pct(a['new_collision_rate'])} → {pct(b['new_collision_rate'])} |")
    lines += ["", "## 처리 시간·색 변화", "",
              "| 자료 | 평균 ΔE A'→v3 | 시간 중앙값 | 시간 최대 | 3초 초과 | 국소 예산 초과 픽셀 |",
              "|---|---:|---:|---:|---:|---:|"]
    for dataset in DATASETS:
        group = [r for r in result["timings"] if r["dataset"] == dataset]
        lines.append(f"| {dataset} | {np.mean([r['baseline_delta_e'] for r in group]):.4f} → {np.mean([r['candidate_delta_e'] for r in group]):.4f} | {np.median([r['candidate_seconds'] for r in group]):.3f}초 | {max(r['candidate_seconds'] for r in group):.3f}초 | {sum(r['candidate_seconds'] > 3 for r in group)}/{len(group)} | {sum(r['local_excess_pixels'] for r in group)} |")
    repeats = result["repeat_timings"]
    lines += ["", f"가장 느렸던 기존 1000px 5건을 각각 두 번 추가 측정했다. 반복 {len(repeats)}건 최대 {max(r['candidate_seconds'] for r in repeats):.3f}초.",
              "시간은 RGB 배열 보정 전체다. A' 계산·군집화·최적화·국소 제한·최종 자체 검증을 포함하며 파일 입출력과 최종 평가만 제외한다.",
              "1000px 측정과 512px 원본 측정은 분리했다. 이 컴퓨터의 별도 단일 스레드 실험 프로세스에서 측정한 값이며,",
              "모든 기기·동시 요청의 3초 응답을 보장하는 수치는 아니다. C 커널은 측정 전 빌드하고 작은 입력으로 1회 초기화했다.",
              "커널이 없으면 NumPy 경로를 사용하며, 같은 속도를 주장하지 않는다.", "",
              "## 검사판·국소 점검", "",
              f"기존/추가 검사판 15장×세기 3개×모델 4개={len(result['plates'])}셀. 그룹 평균 대비 하락 {sum(not r['pass'] for r in decision['plate_summary'])}/{len(decision['plate_summary'])}셀.",
              f"개별 검사판 대비 하락 {sum(r['candidate_contrast'] < r['baseline_contrast'] - .001 for r in result['plates'])}/{len(result['plates'])}셀도 별도로 공개한다.",
              "숫자 대비는 점 중심의 숫자/배경 평균 Lab 거리이며, 사람의 숫자 인식 정답률이 아니다.",
              f"작품에서 A' 복귀 {decision['fallback_cases']}/{len(result['timings'])}건, 개별 작품·유형·모델 회복 쌍 하락 {decision['individual_drops']}/{len(result['artworks'])}셀.",
              "국소 시각 점검과 v2 비교는 실행 후 원본 해상도 잘라보기로 추가한다.", "",
              "## 원자료·재현", "",
              f"- [전체 JSON]({rel(out / 'results.json')}) / [작품 CSV]({rel(out / 'artworks.csv')}) / [검사판 CSV]({rel(out / 'plates.csv')})",
              f"- [비교 사진]({rel(out / 'panels')})",
              "- 최적화와 후보 선택은 Machado만 사용한다. 다른 네 설정은 서로 같은 원뿔 투영 계열이라는 한계가 있다.",
              "- 픽셀별 ΔE 제한은 국소 변화량의 보장이다. 색의 의미·자연스러움·실제 사용자 구분 성능은 별도로 평가해야 한다.",
              "- 컴파일러와 소스·라이브러리 해시는 원자료에 기록했다. 이전 v2는 그대로 보존했다.", "",
              "```powershell", "$env:OPENBLAS_NUM_THREADS = '1'", "$env:OMP_NUM_THREADS = '1'", "$env:MKL_NUM_THREADS = '1'",
              ".\\Backend\\.venv\\Scripts\\python.exe -m Backend.ai.local_native",
              ".\\Backend\\.venv\\Scripts\\python.exe -m Backend.ai.local_experiment --out Backend/data/eval/pixel-v3-reproduction --report Backend/data/eval/pixel-v3-reproduction/report.md", "```", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def run(out, report_path):
    if out.exists():
        raise FileExistsError("Use a new output directory; final evaluations are never overwritten")
    frozen_path = DOCS / "frozen.json"
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen["config"] != asdict(LocalConfig()):
        raise ValueError("Configuration differs from the frozen version")
    verify = lambda: all(sha(ROOT / path) == value for path, value in frozen["source_sha256"].items())
    if not verify() or not local_native.available():
        raise ValueError("Frozen source changed or native kernel is not built")
    if sha(local_native.library_path()) != frozen["library_sha256"]:
        raise ValueError("Native kernel differs from the recorded build")
    cv2.setNumThreads(1)  # Experiment worker only, never set inside the correction API.
    old = json.loads((ROOT / "Backend/data/eval/pixel-v2/results.json").read_text(encoding="utf-8"))
    dataset = [{**r, "dataset": "previous12" if r["dataset"] == "new12" else r["dataset"]} for r in old["dataset"]]
    manifest = json.loads((DOCS / "holdout.json").read_text(encoding="utf-8"))
    dataset += [{"dataset": "fresh12", "id": "nga-fresh-" + r["object_id"], "title": r["title"], "path": r["path"], "sha256": r["sha256"]} for r in manifest["artworks"]]
    if any(sha(ROOT / r["path"]) != r["sha256"] for r in dataset):
        raise ValueError("Input image changed")
    out.mkdir(parents=True)
    (out / "panels").mkdir()
    (out / "selected").mkdir()
    result = {"created": datetime.now().astimezone().isoformat(), "frozen": frozen, "dataset": dataset,
              "timings": [], "repeat_timings": [], "artworks": [], "plates": [], "plate_timings": [],
              "environment": {"python": sys.version, "numpy": np.__version__, "opencv": cv2.__version__,
                              "platform": platform.platform(), "processor": platform.processor(), "opencv_threads": cv2.getNumThreads(),
                              "thread_environment": {k: os.environ.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}}}
    correct_local(np.random.default_rng(17).uniform(.15, .8, (32, 32, 3)).astype(np.float32), "deutan")
    selected = {("nga-02", "tritan"), ("nga-new-46506", "deutan"), ("nga-01", "protan"), ("aic-02", "deutan")}
    for index, record in enumerate(dataset, 1):
        rgb = load_artwork(ROOT / record["path"])
        for color in TYPES:
            a, b, timing = measure(rgb, color)
            result["timings"].append({"dataset": record["dataset"], "artwork": record["id"], "color_type": color,
                                      "width": rgb.shape[1], "height": rgb.shape[0], **timing})
            for row in fast_artwork_metrics(rgb, a, b, color):
                result["artworks"].append({"dataset": record["dataset"], "artwork": record["id"], "color_type": color, **row})
            panel(*(metric_size(x, 360) for x in (rgb, a, b)), color, f"v3 · {record['title']} · {color}", out / "panels" / f"{record['id']}-{color}.jpg")
            if (record["id"], color) in selected:
                save_rgb(b, out / "selected" / f"{record['id']}-{color}-v3.png")
                np.save(out / "selected" / f"{record['id']}-{color}-v3.npy", b)
            print(f"ART {index}/{len(dataset)} {record['id']} {color}: {timing['candidate_seconds']:.3f}s selected={timing['diagnostics']['selected']}", flush=True)
        (out / "checkpoint.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    slowest = sorted([r for r in result["timings"] if r["dataset"] == "regression21"], key=lambda r: r["candidate_seconds"], reverse=True)[:5]
    for row in slowest:
        record = next(r for r in dataset if r["id"] == row["artwork"])
        rgb = load_artwork(ROOT / record["path"])
        for repeat in (1, 2):
            start = perf_counter()
            b, _ = correct_local(rgb, row["color_type"])
            elapsed = perf_counter() - start
            identical = hashlib.sha256(b.tobytes()).hexdigest() == row["output_sha256"]
            result["repeat_timings"].append({"artwork": row["artwork"], "color_type": row["color_type"], "repeat": repeat,
                                             "candidate_seconds": elapsed, "identical": identical})
            print(f"REPEAT {row['artwork']} {row['color_type']} {repeat}: {elapsed:.3f}s identical={identical}", flush=True)
    for original_path in sorted((ROOT / "Backend/data/eval/pixel-v2/plates").glob("*-original.png")):
        stem = original_path.name.removesuffix("-original.png")
        color, number, seed = stem.split("-")
        group = "new" if int(seed) >= 9000 else "legacy"
        with Image.open(original_path) as source:
            rgb = np.asarray(source.convert("RGB"), np.float32) / 255
        dots = json.loads(original_path.with_name(stem + "-dots.json").read_text(encoding="utf-8"))
        for strength in STRENGTHS:
            a, b, timing = measure(rgb, color, strength)
            result["plate_timings"].append({"plate": stem, "color_type": color, "strength": strength, **timing})
            for model in MODELS:
                result["plates"].append({"plate": stem, "group": group, "color_type": color, "strength": strength, "model": model,
                                          "baseline_contrast": fast_number_contrast(a, dots, model, color),
                                          "candidate_contrast": fast_number_contrast(b, dots, model, color),
                                          "selected": timing["diagnostics"]["selected"]})
            if strength == 1.:
                panel(*(metric_size(x, 360) for x in (rgb, a, b)), color, f"v3 · {color} · {number}", out / "panels" / f"plate-{stem}.jpg")
        print(f"PLATE {stem} complete", flush=True)
    if not verify():
        raise RuntimeError("Source changed during final evaluation")
    result["summary"] = summarize(result["artworks"])
    result["assessment"] = assess(result)
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
    print(json.dumps(result["assessment"]["checks"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "Backend/data/eval/pixel-v3")
    parser.add_argument("--report", type=Path, default=DOCS / "report.md")
    args = parser.parse_args()
    run(args.out.resolve(), args.report.resolve())
