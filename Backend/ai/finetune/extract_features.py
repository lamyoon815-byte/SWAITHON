"""학습용 그림 400점의 CLIP 특징(임베딩)을 미리 계산해 저장한다.

그림마다 원본 1장 + 휴대폰 촬영처럼 바꾼 사진 16장(augment.py)을 만들고, 서버와 똑같은 CLIP 모델·전처리로
임베딩을 계산한다. 학습(train_adapter.py)은 이 숫자만 쓰므로 CLIP을 다시 돌릴 필요가 없어 몇 초~몇 분이면 끝난다.

실행 (SWAITHON 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\finetune\\extract_features.py
결과: Backend/data/finetune/features.npz
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))

from augment import phone_capture  # noqa: E402

DATA_DIR = BACKEND / "data"
IMAGE_DIR = DATA_DIR / "finetune" / "train_images"
OUTPUT = DATA_DIR / "finetune" / "features.npz"


def make_views(args):
    """한 그림의 원본 + 증강 k장을 만든다. (여러 프로세스에서 나눠 실행)"""
    path, k, seed = args
    rng = np.random.default_rng(seed)
    with Image.open(path) as source:
        original = source.convert("RGB")
    original.thumbnail((512, 512))
    return [original] + [phone_capture(original, rng) for _ in range(k)]


def encode_batch(encoder, torch, images):
    tensors = torch.stack([encoder.preprocess(image) for image in images])
    with torch.inference_mode():
        features = encoder.model.encode_image(tensors)
        features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
    return features.cpu().numpy().astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--views", type=int, default=16, help="그림 1점당 만들 휴대폰 촬영 흉내 사진 수")
    parser.add_argument("--seed", type=int, default=20261110)
    parser.add_argument("--workers", type=int, default=max(1, min(4, (os.cpu_count() or 2) - 1)))
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
    os.environ.setdefault("CLIP_NUM_THREADS", str(max(1, (os.cpu_count() or 2) - 1)))
    from recognition import ClipEncoder  # 서버와 같은 모델·전처리를 쓰기 위해 서버 코드를 그대로 사용

    paths = sorted(IMAGE_DIR.glob("*.jpg"))
    if len(paths) < 50:
        raise SystemExit(f"학습용 그림이 {len(paths)}점뿐입니다. download_training.py를 먼저 실행해 주세요.")
    encoder = ClipEncoder(DATA_DIR)
    torch = encoder._load()
    print(f"CLIP {encoder.model_name}/{encoder.pretrained} · 그림 {len(paths)}점 × (원본 1 + 변형 {args.views}) · 작업 프로세스 {args.workers}개")

    originals, augmented, ids = [], [], []
    started = time.time()
    jobs = [(path, args.views, args.seed + index) for index, path in enumerate(paths)]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, (path, views) in enumerate(zip(paths, pool.map(make_views, jobs, chunksize=4)), 1):
            vectors = encode_batch(encoder, torch, views)
            originals.append(vectors[0])
            augmented.append(vectors[1:])
            ids.append(path.stem)
            if index % 25 == 0 or index == len(paths):
                elapsed = time.time() - started
                remaining = elapsed / index * (len(paths) - index)
                print(f"[{index}/{len(paths)}] {elapsed / 60:.1f}분 경과, 약 {remaining / 60:.1f}분 남음")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUTPUT, ids=np.array(ids), originals=np.stack(originals), augmented=np.stack(augmented),
                        model=np.array(encoder.model_name), pretrained=np.array(encoder.pretrained),
                        views=np.array(args.views), seed=np.array(args.seed))
    print(f"\n저장 완료: {OUTPUT}  (그림 {len(ids)}점, 임베딩 {len(ids) * (args.views + 1)}개)")


if __name__ == "__main__":
    main()
