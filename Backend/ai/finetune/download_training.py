"""파인튜닝 학습용 그림 400점(NGA 공개 이미지)을 내려받는다.

- 목록은 training_artworks.json에 있다. NGA 공개 데이터셋(openaccess=1)에서 고른 회화 330점·판화 45점·드로잉 25점이며,
  등록 작품 21점과 평가용 미등록 작품 10점(+같은 작품의 다른 인쇄본)은 제외했다. → 시험 문제가 학습에 섞이지 않는다.
- CLIP 입력이 224px이므로 긴 변 512px로 받는다. 이미 받은 파일은 건너뛴다.

실행 (SWAITHON 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\finetune\\download_training.py
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parents[1] / "data" / "finetune" / "train_images"
USER_AGENT = "SWAITHON-student-project/1.0 (+https://github.com/lamyoon815-byte/SWAITHON)"


def fetch(item):
    target = OUT_DIR / f"{item['object_id']}.jpg"
    if target.exists() and target.stat().st_size > 0:
        return item, "skip"
    url = f"{item['iiif']}/full/!512,512/0/default.jpg"
    last = None
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                data = response.read()
            temporary = target.with_suffix(".part")
            temporary.write_bytes(data)
            temporary.replace(target)
            return item, "ok"
        except Exception as exc:  # 네트워크 오류는 잠시 쉬고 다시 시도
            last = exc
            time.sleep(1 + attempt)
    return item, f"fail: {last}"


def main():
    items = json.loads((HERE / "training_artworks.json").read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done = failed = 0
    # 미술관 서버에 부담을 주지 않도록 동시에 4개까지만 받는다.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(fetch, item) for item in items]
        for index, future in enumerate(as_completed(futures), 1):
            item, status = future.result()
            if status.startswith("fail"):
                failed += 1
                print(f"  실패 {item['object_id']} {item['title'][:40]} - {status}")
            else:
                done += 1
            if index % 50 == 0 or index == len(items):
                print(f"[{index}/{len(items)}] 진행 중... (성공 {done}, 실패 {failed})")
    print(f"\n저장 위치: {OUT_DIR}")
    print(f"성공 {done}점 / 실패 {failed}점")
    if failed:
        print("실패한 그림이 있어도 학습은 할 수 있어요. 같은 명령을 한 번 더 실행하면 실패한 것만 다시 받습니다.")


if __name__ == "__main__":
    main()
