"""CLIP-Adapter 파인튜닝: 휴대폰 촬영본 임베딩이 같은 작품의 원본 임베딩과 가까워지도록 작은 어댑터만 학습한다.

과적합을 막는 장치
1. CLIP 본체는 고정하고 어댑터(약 13만 개 값)만 학습한다.
2. 잔차 구조: 결과 = alpha·어댑터(x) + (1-alpha)·x 이므로 원래 CLIP 특징을 크게 벗어나지 않는다.
3. 학습 그림 400점 중 15%(60점)는 학습에서 빼 두고(검증용), 검증 손실이 좋아지지 않으면 조기 종료한다.
4. 등록 작품 21점·평가용 미등록 10점은 학습 데이터에 아예 없다. 최종 성능은 실제 촬영본으로 evaluation.py에서 잰다.
5. 가중치 감쇠(weight decay)와 작은 은닉층(128)으로 모델이 외우는 능력을 제한한다.

손실 함수: 대조 학습(InfoNCE, CLIP과 같은 방식). 한 배치에서 촬영본 i는 원본 i와 가깝게, 다른 원본과는 멀게.

실행 (MoMi 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\finetune\\train_adapter.py
결과: Backend/data/clip-adapter.npz (서버가 자동으로 사용), Backend/data/finetune/train_report.json
"""
import argparse
import json
from pathlib import Path
import sys
import time

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))

from ai.adapter import ADAPTER_FILENAME, ClipAdapter  # noqa: E402

DATA_DIR = BACKEND / "data"
FEATURES = DATA_DIR / "finetune" / "features.npz"
REPORT = DATA_DIR / "finetune" / "train_report.json"


def build_adapter(torch, dim, hidden, alpha):
    nn = torch.nn

    class Adapter(nn.Module):
        def __init__(self):
            super().__init__()
            self.fc1 = nn.Linear(dim, hidden)
            self.fc2 = nn.Linear(hidden, dim)
            nn.init.zeros_(self.fc2.weight)  # 처음에는 원래 CLIP과 똑같이 시작한다.
            nn.init.zeros_(self.fc2.bias)
            self.alpha = alpha

        def forward(self, x):
            mixed = self.alpha * self.fc2(torch.relu(self.fc1(x))) + (1 - self.alpha) * x
            return mixed / mixed.norm(dim=-1, keepdim=True).clamp_min(1e-12)

    return Adapter()


def retrieval_metrics(torch, model, originals, augmented):
    """증강 촬영본으로 원본을 찾는 시험: Top-1, Top-3 정확도와 대조 손실."""
    with torch.no_grad():
        n, k, dim = augmented.shape
        gallery = model(originals)
        queries = model(augmented.reshape(n * k, dim))
        scores = queries @ gallery.T
        labels = torch.arange(n).repeat_interleave(k)
        top = scores.topk(min(3, n), dim=1).indices
        top1 = (top[:, 0] == labels).float().mean().item()
        top3 = (top == labels[:, None]).any(dim=1).float().mean().item()
        correct = scores[torch.arange(n * k), labels]
        scores_wrong = scores.clone()
        scores_wrong[torch.arange(n * k), labels] = -2
        margin = (correct - scores_wrong.max(dim=1).values).mean().item()  # 정답 점수 - 가장 비슷한 오답 점수
    return {"top1": round(top1, 4), "top3": round(top3, 4), "margin": round(margin, 4)}


def contrastive_loss(torch, model, originals, augmented, temperature, generator):
    n, k, _ = augmented.shape
    pick = torch.randint(0, k, (n,), generator=generator)
    queries = model(augmented[torch.arange(n), pick])
    keys = model(originals)
    logits = queries @ keys.T / temperature
    labels = torch.arange(n)
    # 촬영본→원본, 원본→촬영본 양방향 (CLIP 학습과 같은 대칭 손실)
    return (torch.nn.functional.cross_entropy(logits, labels) + torch.nn.functional.cross_entropy(logits.T, labels)) / 2


def validation_loss(torch, model, originals, augmented, temperature):
    with torch.no_grad():
        n, k, _ = augmented.shape
        keys = model(originals)
        losses = []
        for view in range(k):
            logits = model(augmented[:, view]) @ keys.T / temperature
            losses.append(torch.nn.functional.cross_entropy(logits, torch.arange(n)).item())
    return float(np.mean(losses))


def train_one(torch, data, alpha, args):
    torch.manual_seed(args.seed)
    generator = torch.Generator().manual_seed(args.seed)
    model = build_adapter(torch, data["dim"], args.hidden, alpha)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    best = {"val_loss": validation_loss(torch, model, data["val_orig"], data["val_aug"], args.temperature),
            "epoch": 0, "state": {key: value.clone() for key, value in model.state_dict().items()}}
    baseline_val_loss, history, waited = best["val_loss"], [], 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(data["train_orig"].shape[0], generator=generator)
        for start in range(0, len(order), args.batch):
            index = order[start:start + args.batch]
            loss = contrastive_loss(torch, model, data["train_orig"][index], data["train_aug"][index],
                                    args.temperature, generator)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        model.eval()
        val = validation_loss(torch, model, data["val_orig"], data["val_aug"], args.temperature)
        history.append({"epoch": epoch, "train_loss": round(loss.item(), 4), "val_loss": round(val, 4)})
        if val < best["val_loss"] - 1e-4:
            best = {"val_loss": val, "epoch": epoch, "state": {key: value.clone() for key, value in model.state_dict().items()}}
            waited = 0
        else:
            waited += 1
            if waited >= args.patience:  # 검증 손실이 더 좋아지지 않으면 멈춘다(조기 종료).
                break
    model.load_state_dict(best["state"])
    model.eval()
    return model, {"alpha": alpha, "best_epoch": best["epoch"], "epochs_run": len(history),
                   "baseline_val_loss": round(baseline_val_loss, 4), "best_val_loss": round(best["val_loss"], 4),
                   "history": history}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--alphas", default="0.2,0.4,0.6", help="잔차 비율 후보. 검증 손실이 가장 낮은 값을 고른다.")
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--patience", type=int, default=25)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--temperature", type=float, default=0.05)
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=20261110)
    args = parser.parse_args()

    import torch
    torch.set_num_threads(max(1, torch.get_num_threads()))
    if not FEATURES.exists():
        raise SystemExit("features.npz가 없습니다. extract_features.py를 먼저 실행해 주세요.")
    with np.load(FEATURES, allow_pickle=False) as saved:
        originals, augmented = saved["originals"].astype(np.float32), saved["augmented"].astype(np.float32)
        model_name, pretrained = str(saved["model"]), str(saved["pretrained"])
    n = originals.shape[0]
    rng = np.random.default_rng(args.seed)
    order = rng.permutation(n)
    val_count = max(10, int(round(n * args.val_ratio)))
    val_index, train_index = np.sort(order[:val_count]), np.sort(order[val_count:])
    tensor = lambda array: torch.from_numpy(np.ascontiguousarray(array))
    # 과적합 점검용: 학습 그림 중 검증과 같은 수만 뽑아 같은 조건(후보 수)에서 비교한다.
    probe_index = np.sort(rng.choice(train_index, size=len(val_index), replace=False))
    data = {"dim": originals.shape[1],
            "train_orig": tensor(originals[train_index]), "train_aug": tensor(augmented[train_index]),
            "val_orig": tensor(originals[val_index]), "val_aug": tensor(augmented[val_index]),
            "probe_orig": tensor(originals[probe_index]), "probe_aug": tensor(augmented[probe_index])}
    print(f"학습 그림 {len(train_index)}점 / 검증 그림 {len(val_index)}점 (그림 단위로 나눠 서로 겹치지 않음)")

    identity = build_adapter(torch, data["dim"], args.hidden, 0.0).eval()
    baseline = {"train": retrieval_metrics(torch, identity, data["probe_orig"], data["probe_aug"]),
                "val": retrieval_metrics(torch, identity, data["val_orig"], data["val_aug"])}
    print(f"파인튜닝 전  검증 Top-1 {baseline['val']['top1']:.1%}  Top-3 {baseline['val']['top3']:.1%}  여유 {baseline['val']['margin']:.3f}")

    started, runs, best = time.time(), [], None
    for alpha in [float(value) for value in args.alphas.split(",")]:
        model, info = train_one(torch, data, alpha, args)
        info["train"] = retrieval_metrics(torch, model, data["probe_orig"], data["probe_aug"])
        info["val"] = retrieval_metrics(torch, model, data["val_orig"], data["val_aug"])
        runs.append(info)
        print(f"alpha {alpha:.1f}: {info['best_epoch']}번째 epoch에서 멈춤 · 검증 손실 {info['baseline_val_loss']} → {info['best_val_loss']}"
              f" · 검증 Top-1 {info['val']['top1']:.1%} · 학습 Top-1 {info['train']['top1']:.1%}")
        if best is None or info["best_val_loss"] < best[1]["best_val_loss"]:
            best = (model, info)

    model, info = best
    state = model.state_dict()
    adapter = ClipAdapter(state["fc1.weight"].T.numpy(), state["fc1.bias"].numpy(), state["fc2.weight"].T.numpy(),
                          state["fc2.bias"].numpy(), info["alpha"], model_name, pretrained,
                          metrics={"val_top1": info["val"]["top1"], "baseline_val_top1": baseline["val"]["top1"],
                                   "best_epoch": info["best_epoch"], "train_images": int(len(train_index))})
    # 학습에 쓴 PyTorch 계산과 서버의 numpy 계산이 같은지 확인한다.
    check = data["val_orig"][:5]
    with torch.no_grad():
        expected = model(check).numpy()
    if not np.allclose(adapter.apply(check.numpy()), expected, atol=1e-4):
        raise SystemExit("어댑터 변환 결과가 PyTorch와 다릅니다. 저장하지 않습니다.")
    adapter.save(DATA_DIR / ADAPTER_FILENAME)

    gap = info["train"]["top1"] - info["val"]["top1"]
    report = {"model": model_name, "pretrained": pretrained, "settings": vars(args), "train_images": int(len(train_index)),
              "val_images": int(len(val_index)), "baseline": baseline, "runs": runs, "chosen_alpha": info["alpha"],
              "fingerprint": adapter.fingerprint, "train_val_top1_gap": round(gap, 4),
              "seconds": round(time.time() - started, 1)}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n선택: alpha {info['alpha']} · 검증 Top-1 {baseline['val']['top1']:.1%} → {info['val']['top1']:.1%}"
          f" · 여유 {baseline['val']['margin']:.3f} → {info['val']['margin']:.3f}")
    print(f"학습·검증 격차: 학습 Top-1 {info['train']['top1']:.1%} vs 검증 Top-1 {info['val']['top1']:.1%} (차이 {gap:+.1%})"
          " — 격차가 작다는 것만으로 과적합이 없다고 단정할 수는 없으며, 실제 촬영본 평가로 함께 판단합니다.")
    print(f"저장: {DATA_DIR / ADAPTER_FILENAME}\n보고서: {REPORT}")
    print("다음 단계: evaluation.py로 실제 촬영본에서 파인튜닝 전/후를 비교하세요.")


if __name__ == "__main__":
    main()
