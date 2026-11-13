"""실제 촬영본으로 작품 인식 성능을 평가하고, 서버 기준값(임계값)을 정한다.

평가 데이터 (Backend/data/eval/)
    registered/<작품 사진 파일 이름>/*  등록 작품 촬영본 (폴더 이름이 정답)
    unregistered/*                      미등록 작품 촬영본 (어떤 등록 작품과도 매칭되면 안 됨)
    not_artwork/*                       손·바닥 등 작품이 아닌 사진 (다시 찍기 안내가 나와야 함)

하는 일
1. 파인튜닝 전(원래 CLIP)과 후(어댑터)를 같은 사진으로 비교: Top-1, Top-3, 점수 분포
2. 기준값을 '정하는 사진'과 '확인하는 사진'을 나누는 교차 검증(작품 단위 5겹)으로, 기준값을 같은 사진에
   맞춰 성능이 부풀려지는 것(과적합)을 막고 실제에 가까운 성능을 잰다.
3. 작품/작품 아님 판별 기준값도 같은 방식으로 정한다.
4. 서버와 같은 경로(사진 정규화 → CLIP → 판별 → 검색)로 1장당 처리 시간을 잰다.
결과: Backend/data/eval/report.md, report.json, 추천 .env 값

실행 (MoMi 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\evaluation.py
    # 작품마다 기준 사진 여러 장(ai/references.py) 실험: --refs N --out refsN → report_refsN.md / .json
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import time

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
# 이 파일을 직접 실행하면 Backend/ai 폴더가 import 경로 맨 앞에 들어가는데, 그 안의 profile.py가
# 파이썬 표준 모듈 profile을 가려 torch가 깨진다. 그래서 이 폴더를 빼고 Backend 폴더를 넣는다.
sys.path[:] = [entry for entry in sys.path if Path(entry or ".").resolve() != Path(__file__).resolve().parent]
sys.path.insert(0, str(BACKEND))

from ai.adapter import ADAPTER_FILENAME, ClipAdapter  # noqa: E402
from ai.artwork_gate import ArtworkGate  # noqa: E402
from ai.decision import decide  # noqa: E402
from ai.references import max_per_owner, reference_contents  # noqa: E402

DATA_DIR = BACKEND / "data"
EVAL_DIR = DATA_DIR / "eval"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
FOLDS = 5


# ---------------------------------------------------------------- 데이터 읽기

def photos_in(folder: Path):
    return sorted(path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)


def load_catalog():
    records = json.loads((BACKEND / "catalog.artworks.json").read_text(encoding="utf-8"))
    return [{"id": record["id"], "title": record["title"], "stem": Path(record["image_path"]).stem,
             "path": BACKEND / record["image_path"]} for record in records]


def collect_photos(catalog):
    by_stem = {record["stem"]: record["id"] for record in catalog}
    photos, unknown = [], []
    for folder in sorted((EVAL_DIR / "registered").glob("*")):
        if folder.is_dir():
            if folder.name not in by_stem:
                unknown.append(folder.name)
                continue
            for path in photos_in(folder):
                photos.append({"path": path, "kind": "registered", "label": by_stem[folder.name], "group": folder.name})
    for path in photos_in(EVAL_DIR / "unregistered"):
        photos.append({"path": path, "kind": "unregistered", "label": None, "group": "u:" + path.stem})
    for path in photos_in(EVAL_DIR / "not_artwork"):
        photos.append({"path": path, "kind": "not_artwork", "label": None, "group": "n:" + path.stem})
    return photos, unknown


# ---------------------------------------------------------------- 기준값 정하기

def threshold_outcomes(top1_ids, top1_scores, kinds, labels, t):
    registered = kinds == "registered"
    unregistered = kinds == "unregistered"
    accepted = top1_scores >= t
    correct = top1_ids == labels
    return {
        "registered": int(registered.sum()), "unregistered": int(unregistered.sum()),
        "correct_accept": int((registered & accepted & correct).sum()),  # 등록 작품을 맞게 찾음
        "wrong_accept": int((registered & accepted & ~correct).sum()),   # 등록 작품을 다른 작품으로 잘못 찾음
        "false_reject": int((registered & ~accepted).sum()),             # 등록 작품인데 미등록으로 판단(오거부)
        "false_match": int((unregistered & accepted).sum()),             # 미등록 작품을 등록 작품으로 잘못 매칭
    }


def rates(counts):
    reg, unreg = max(counts["registered"], 1), max(counts["unregistered"], 1)
    return {"정답 인정률": counts["correct_accept"] / reg, "등록 오답 매칭률": counts["wrong_accept"] / reg,
            "등록 오거부율": counts["false_reject"] / reg, "미등록 오매칭률": counts["false_match"] / unreg}


def choose_match_threshold(top1_ids, top1_scores, kinds, labels):
    """맞게 찾은 비율 + 미등록을 거른 비율 - 잘못 찾은 비율이 가장 큰 기준값. 같으면 더 엄격한(높은) 값을 고른다."""
    use = (kinds == "registered") | (kinds == "unregistered")
    values = np.unique(top1_scores[use])
    candidates = np.concatenate([[values.min() - 1e-3], (values[:-1] + values[1:]) / 2, [values.max() + 1e-3]])
    best_t, best_j = None, -np.inf
    for t in candidates:
        r = rates(threshold_outcomes(top1_ids, top1_scores, kinds, labels, t))
        j = r["정답 인정률"] - r["등록 오답 매칭률"] + (1 - r["미등록 오매칭률"])
        if j > best_j + 1e-9 or (abs(j - best_j) <= 1e-9 and t > best_t):
            best_t, best_j = float(t), j
    return round(best_t, 4)


def choose_high_threshold(top1_ids, top1_scores, kinds, labels, match_t):
    """이 점수 이상이면 확인 없이 바로 이동해도 되는 기준: 오답·미등록 중 가장 높은 점수보다 0.01 높게."""
    wrong = ((kinds == "registered") & (top1_ids != labels)) | (kinds == "unregistered")
    worst = float(top1_scores[wrong].max()) if wrong.any() else -1.0
    t = max(match_t, worst + 0.01)
    return round(t, 4) if t <= 1 else None


def choose_gate_threshold(probabilities, kinds):
    """작품 사진은 통과, 작품 아닌 사진은 걸러내는 균형 정확도가 가장 큰 값. 같으면 더 관대한(낮은) 값을 고른다."""
    artwork = kinds != "not_artwork"
    if artwork.all() or not artwork.any():
        return 0.5
    values = np.unique(probabilities)
    candidates = np.clip(np.concatenate([[values.min() - 1e-4], (values[:-1] + values[1:]) / 2]), 1e-4, 1 - 1e-4)
    best_t, best_score = 0.5, -1
    for t in candidates:
        passed = probabilities >= t
        score = (passed[artwork].mean() + (~passed[~artwork]).mean()) / 2
        if score > best_score + 1e-9 or (abs(score - best_score) <= 1e-9 and t < best_t):
            best_t, best_score = float(t), score
    return round(best_t, 4)


def group_folds(groups, seed):
    unique = sorted(set(groups))
    order = np.random.default_rng(seed).permutation(len(unique))
    fold_of = {unique[index]: position % FOLDS for position, index in enumerate(order)}
    return np.array([fold_of[group] for group in groups])


# ---------------------------------------------------------------- 평가

def evaluate_config(name, gallery, adapter, photos, raw, probabilities, catalog, seed, owners=None):
    """owners[j] = 기준 사진 j가 속한 작품의 카탈로그 순서. None이면 작품마다 1장(gallery 행 = 작품)."""
    kinds = np.array([photo["kind"] for photo in photos])
    labels = np.array([photo["label"] or "" for photo in photos])
    groups = [photo["group"] for photo in photos]
    ids = np.array([record["id"] for record in catalog])
    g = adapter.apply(gallery) if adapter else gallery
    q = adapter.apply(raw) if adapter else raw
    scores = q @ g.T
    if owners is not None:
        scores = max_per_owner(scores, owners, len(catalog))  # 작품별 점수 = 그 작품 기준 사진 중 최고점
    order = np.argsort(-scores, axis=1)
    top1_ids, top1_scores = ids[order[:, 0]], scores[np.arange(len(photos)), order[:, 0]]
    registered = kinds == "registered"
    top3_hit = np.array([labels[i] in ids[order[i, :3]] for i in range(len(photos))])

    # 교차 검증: 기준값은 '나머지 4겹'으로 정하고 '남겨둔 1겹'에서 확인한다.
    folds = group_folds(groups, seed)
    pooled = {key: 0 for key in ("registered", "unregistered", "correct_accept", "wrong_accept", "false_reject", "false_match")}
    actions = {kind: {} for kind in ("registered", "unregistered", "not_artwork")}
    fold_thresholds = []
    for fold in range(FOLDS):
        test, train = folds == fold, folds != fold
        if not test.any():
            continue
        t = choose_match_threshold(top1_ids[train], top1_scores[train], kinds[train], labels[train])
        high = choose_high_threshold(top1_ids[train], top1_scores[train], kinds[train], labels[train], t)
        gate_t = choose_gate_threshold(probabilities[train], kinds[train]) if probabilities is not None else None
        fold_thresholds.append({"match": t, "high": high, "gate": gate_t})
        for key, value in threshold_outcomes(top1_ids[test], top1_scores[test], kinds[test], labels[test], t).items():
            pooled[key] += value
        for i in np.where(test)[0]:
            outcome = decide([float(top1_scores[i])], match_threshold=t, high_threshold=high,
                             artwork_probability=None if probabilities is None else float(probabilities[i]),
                             gate_threshold=gate_t)
            action = outcome["next_action"]
            if outcome["next_action"] in {"show_artwork", "confirm_candidates"} and kinds[i] == "registered":
                action += "(정답)" if top1_ids[i] == labels[i] else "(오답)"
            actions[kinds[i]][action] = actions[kinds[i]].get(action, 0) + 1

    final_t = choose_match_threshold(top1_ids, top1_scores, kinds, labels)
    final_high = choose_high_threshold(top1_ids, top1_scores, kinds, labels, final_t)
    final_gate = choose_gate_threshold(probabilities, kinds) if probabilities is not None else None
    cv = rates(pooled)
    return {
        "name": name,
        "top1": float((top1_ids[registered] == labels[registered]).mean()) if registered.any() else None,
        "top3": float(top3_hit[registered].mean()) if registered.any() else None,
        "score_registered_correct": describe(top1_scores[registered & (top1_ids == labels)]),
        "score_unregistered": describe(top1_scores[kinds == "unregistered"]),
        "score_not_artwork": describe(top1_scores[kinds == "not_artwork"]),
        "cv_counts": pooled, "cv_rates": {key: round(value, 4) for key, value in cv.items()},
        "cv_score": round(cv["정답 인정률"] - cv["등록 오답 매칭률"] + (1 - cv["미등록 오매칭률"]), 4),
        "cv_actions": actions, "fold_thresholds": fold_thresholds,
        "match_threshold": final_t, "high_threshold": final_high, "gate_threshold": final_gate,
        "per_photo": [{"file": str(photo["path"].relative_to(EVAL_DIR)), "kind": photo["kind"], "label": photo["label"],
                       "top1": str(top1_ids[i]), "score": round(float(top1_scores[i]), 4),
                       "artwork_probability": None if probabilities is None else round(float(probabilities[i]), 4)}
                      for i, photo in enumerate(photos)],
    }


def describe(values):
    if len(values) == 0:
        return None
    return {"n": int(len(values)), "min": round(float(values.min()), 4), "mean": round(float(values.mean()), 4),
            "max": round(float(values.max()), 4)}


def pct(value):
    return "-" if value is None else f"{value * 100:.1f}%"


def write_report(result, path):
    lines = [f"# 작품 인식 평가 보고서", "", f"- 평가 시각: {result['created']}",
             f"- CLIP: {result['model']} / {result['pretrained']}",
             f"- 사진: 등록 작품 {result['counts']['registered']}장 ({result['counts']['registered_artworks']}점), "
             f"미등록 작품 {result['counts']['unregistered']}장, 작품 아닌 사진 {result['counts']['not_artwork']}장",
             *([f"- 기준 사진: 작품마다 원본 + 가운데 자르기 2장 + 휴대폰 촬영 흉내 {result['reference_variants']}장 "
                f"(모두 {result['reference_rows']}장, 작품별 점수는 최고점)"] if result.get("reference_variants") else []),
             f"- 기준값은 작품 단위 {FOLDS}겹 교차 검증으로 정하고 확인했습니다(기준을 정한 사진과 확인한 사진이 다름).", "",
             "## 1. 파인튜닝 전/후 비교", "",
             "| 항목 | " + " | ".join(config["name"] for config in result["configs"]) + " |",
             "|---|" + "---|" * len(result["configs"])]
    rows = [("Top-1 (1순위가 정답)", lambda c: pct(c["top1"])), ("Top-3 (3순위 안에 정답)", lambda c: pct(c["top3"])),
            ("정답 인정률 (교차 검증)", lambda c: pct(c["cv_rates"]["정답 인정률"])),
            ("등록 오답 매칭률 (교차 검증)", lambda c: pct(c["cv_rates"]["등록 오답 매칭률"])),
            ("등록 오거부율 (교차 검증)", lambda c: pct(c["cv_rates"]["등록 오거부율"])),
            ("미등록 오매칭률 (교차 검증)", lambda c: pct(c["cv_rates"]["미등록 오매칭률"])),
            ("종합 점수 (높을수록 좋음, 최대 2)", lambda c: f"{c['cv_score']:.3f}"),
            ("등록 정답 점수 평균", lambda c: "-" if not c["score_registered_correct"] else f"{c['score_registered_correct']['mean']:.3f}"),
            ("미등록 최고 점수", lambda c: "-" if not c["score_unregistered"] else f"{c['score_unregistered']['max']:.3f}")]
    for label, getter in rows:
        lines.append(f"| {label} | " + " | ".join(getter(config) for config in result["configs"]) + " |")
    chosen = result["chosen"]
    lines += ["", f"**채택: {chosen['name']}** — {chosen['why']}", "",
              "## 2. 앱 동작 시뮬레이션 (교차 검증, 채택 설정)", "",
              "| 사진 종류 | 결과 |", "|---|---|"]
    for kind, label in (("registered", "등록 작품"), ("unregistered", "미등록 작품"), ("not_artwork", "작품 아닌 사진")):
        counts = chosen["config"]["cv_actions"][kind]
        lines.append(f"| {label} | " + (", ".join(f"{key} {value}장" for key, value in sorted(counts.items())) or "-") + " |")
    lines += ["", "- show_artwork: 바로 이동 / confirm_candidates: 후보 확인 / analyze: AI 해설 / retake: 다시 촬영", ""]
    if result.get("training"):
        training = result["training"]
        gap_text = ("이번 평가에서는 학습·검증 성능 격차가 관찰되지 않았습니다" if abs(training["gap"]) < 0.02
                    else f"학습·검증 성능 격차 {training['gap'] * 100:+.1f}%p가 관찰됐습니다")
        lines += ["## 3. 학습·검증 성능 격차 점검 (파인튜닝)", "",
                  f"- 학습 그림 {training['train_images']}점, 검증 그림 {training['val_images']}점 (그림 단위로 분리, 등록·평가 작품은 학습에서 제외)",
                  f"- 같은 조건에서 학습 Top-1 {pct(training['train_top1'])} vs 검증 Top-1 {pct(training['val_top1'])} (차이 {training['gap'] * 100:+.1f}%p)",
                  f"- 해석: {gap_text}. 격차가 작다는 것만으로 과적합이 없다고 단정할 수는 없으므로, 실제 촬영본 결과(1번 표)와 함께 판단합니다.",
                  f"- 조기 종료: {training['best_epoch']}번째 epoch에서 검증 손실이 가장 낮아 그 시점 가중치를 사용",
                  "- 최종 성능은 학습에 한 번도 쓰지 않은 실제 촬영본(위 1번 표)으로 측정", ""]
    lines += ["## 4. 처리 시간 (서버와 같은 경로, 이 컴퓨터 CPU)", "",
              f"- 사진 1장: 평균 {result['latency_ms']['mean']:.0f}ms, 95% 이내 {result['latency_ms']['p95']:.0f}ms "
              f"(사진 정규화 → CLIP → 작품 판별 → 검색)", "",
              "## 5. 서버 설정 (.env)", "", "```", *result["env_lines"], "```", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261110)
    parser.add_argument("--refs", type=int, default=0, help="작품마다 휴대폰 촬영 흉내 기준 사진 수 (0 = 지금처럼 원본 1장)")
    parser.add_argument("--out", default="report", help="보고서 이름. report면 report.md, 다른 이름이면 report_<이름>.md")
    args = parser.parse_args()
    stem = "report" if args.out == "report" else f"report_{args.out}"

    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
    from images import normalize_image
    from recognition import ClipEncoder

    catalog = load_catalog()
    photos, unknown = collect_photos(catalog)
    if unknown:
        print("경고: 카탈로그에 없는 폴더 이름은 건너뜁니다 → " + ", ".join(unknown))
    counts = {kind: sum(photo["kind"] == kind for photo in photos) for kind in ("registered", "unregistered", "not_artwork")}
    counts["registered_artworks"] = len({photo["label"] for photo in photos if photo["kind"] == "registered"})
    print(f"사진: 등록 {counts['registered']}장({counts['registered_artworks']}점) · 미등록 {counts['unregistered']}장 · 작품 아님 {counts['not_artwork']}장")
    if counts["registered"] < 5 or counts["unregistered"] < 2:
        raise SystemExit("평가 사진이 너무 적습니다. registered 폴더와 unregistered 폴더에 사진을 넣어 주세요.")

    encoder = ClipEncoder(DATA_DIR)
    encoder.warmup()
    gate = ArtworkGate(encoder, 0.5)
    gate.warmup()
    print(f"등록 작품 기준 사진 임베딩 계산 중... (작품마다 휴대폰 촬영 흉내 {args.refs}장)")
    rows, owners = [], []
    for index, record in enumerate(catalog):
        for content in reference_contents(record["path"].read_bytes(), args.refs, index):
            rows.append(encoder.encode(content))
            owners.append(index)
    gallery, owners = np.stack(rows), np.array(owners)
    print(f"  기준 사진 {len(owners)}장 (작품 {len(catalog)}점)")
    adapter_path = DATA_DIR / ADAPTER_FILENAME
    adapter = ClipAdapter.load(adapter_path) if adapter_path.exists() else None
    adapted_gallery = adapter.apply(gallery) if adapter else gallery

    print("촬영본 처리 중 (서버와 같은 경로로 시간 측정)...")
    raw, probabilities, latencies = [], [], []
    for index, photo in enumerate(photos, 1):
        content = photo["path"].read_bytes()
        started = time.perf_counter()
        normalized = normalize_image(content).content
        vector = encoder.encode(normalized)
        probability = gate.artwork_probability(vector)
        query = adapter.apply(vector) if adapter else vector
        _ = int(np.argmax(max_per_owner(adapted_gallery @ query, owners, len(catalog))))
        latencies.append((time.perf_counter() - started) * 1000)
        raw.append(vector)
        probabilities.append(probability)
        if index % 20 == 0 or index == len(photos):
            print(f"  [{index}/{len(photos)}]")
    raw, probabilities = np.stack(raw), np.array(probabilities)

    configs = [evaluate_config("파인튜닝 전 (원래 CLIP)", gallery, None, photos, raw, probabilities, catalog, args.seed, owners)]
    if adapter:
        configs.append(evaluate_config("파인튜닝 후 (CLIP + 어댑터)", gallery, adapter, photos, raw, probabilities, catalog,
                                       args.seed, owners))
    base, tuned = configs[0], configs[-1]
    better = adapter and (
        (tuned["cv_score"] > base["cv_score"] + 1e-9 and tuned["top1"] >= base["top1"])
        or (tuned["cv_score"] >= base["cv_score"] - 1e-9 and tuned["top1"] > base["top1"]))
    if better:
        chosen = {"name": tuned["name"], "config": tuned, "adapter": "on",
                  "why": f"교차 검증 종합 점수 {base['cv_score']:.3f} → {tuned['cv_score']:.3f}, Top-1 {pct(base['top1'])} → {pct(tuned['top1'])}로 좋아졌습니다."}
    elif adapter:
        chosen = {"name": base["name"], "config": base, "adapter": "off",
                  "why": "실제 촬영본에서 파인튜닝 후 성능이 좋아지지 않아 원래 CLIP을 유지합니다(어댑터는 끔). 과적합이나 효과 없는 학습을 서비스에 넣지 않기 위한 규칙입니다."}
    else:
        chosen = {"name": base["name"], "config": base, "adapter": "off", "why": "어댑터 파일이 없어 원래 CLIP만 평가했습니다."}
    config = chosen["config"]
    env_lines = [f"CLIP_ADAPTER={chosen['adapter']}", f"CLIP_MATCH_THRESHOLD={config['match_threshold']}"]
    if config["high_threshold"] is not None:
        env_lines.append(f"CLIP_HIGH_CONFIDENCE_THRESHOLD={config['high_threshold']}")
    if config["gate_threshold"] is not None and counts["not_artwork"]:
        env_lines.append(f"ARTWORK_GATE_THRESHOLD={config['gate_threshold']}")
    env_lines.append("CLIP_WARMUP=1")

    training = None
    report_path = DATA_DIR / "finetune" / "train_report.json"
    if adapter and report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        run = next((run for run in report["runs"] if run["alpha"] == report["chosen_alpha"]), None)
        if run:
            training = {"train_images": report["train_images"], "val_images": report["val_images"],
                        "train_top1": run["train"]["top1"], "val_top1": run["val"]["top1"],
                        "gap": run["train"]["top1"] - run["val"]["top1"], "best_epoch": run["best_epoch"]}

    latency = np.array(latencies)
    result = {"created": datetime.now().isoformat(timespec="seconds"), "model": encoder.model_name,
              "pretrained": encoder.pretrained, "counts": counts, "configs": configs,
              "chosen": {key: value for key, value in chosen.items()}, "env_lines": env_lines, "training": training,
              "latency_ms": {"mean": float(latency.mean()), "p95": float(np.percentile(latency, 95))},
              "adapter_fingerprint": adapter.fingerprint if adapter else None,
              "seed": args.seed, "reference_variants": args.refs, "reference_rows": int(len(owners))}
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    (EVAL_DIR / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    write_report(result, EVAL_DIR / f"{stem}.md")

    for item in configs:
        print(f"\n[{item['name']}] Top-1 {pct(item['top1'])} · Top-3 {pct(item['top3'])} · "
              + " · ".join(f"{key} {pct(value)}" for key, value in item["cv_rates"].items()))
    print(f"\n채택: {chosen['name']} — {chosen['why']}")
    print(f"처리 시간: 평균 {result['latency_ms']['mean']:.0f}ms / 95% {result['latency_ms']['p95']:.0f}ms")
    print("\n.env에 넣을 값:\n" + "\n".join(env_lines))
    print(f"\n보고서: {EVAL_DIR / (stem + '.md')}")


if __name__ == "__main__":
    main()
