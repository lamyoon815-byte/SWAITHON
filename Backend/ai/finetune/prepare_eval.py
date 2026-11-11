"""평가용 폴더를 만들고, 촬영에 쓸 '미등록 작품' 원본 10점을 내려받는다.

실행 (MoMi 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\finetune\\prepare_eval.py

결과
    Backend/data/eval/registered/<작품 파일 이름>/   ← 등록 작품 21점 촬영본을 3장씩 넣는 폴더 (자동 생성)
    Backend/data/eval/unregistered/                 ← 미등록 작품 촬영본 10장을 넣는 폴더
    Backend/data/eval/not_artwork/                  ← 손·바닥 등 작품이 아닌 사진 15장을 넣는 폴더
    Backend/data/eval/unregistered_originals/       ← 모니터에 띄워 촬영할 미등록 작품 원본 10점
"""
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_set import UNREGISTERED  # noqa: E402

BACKEND = Path(__file__).resolve().parents[2]
EVAL_DIR = BACKEND / "data" / "eval"
USER_AGENT = "MoMi-student-project/1.0 (+https://github.com/lamyoon815-byte/SWAITHON)"


def registered_folders():
    """등록 작품 사진 파일 이름(확장자 제외) → 카탈로그 ID."""
    catalog = BACKEND / "catalog.artworks.json"
    if catalog.exists():
        records = json.loads(catalog.read_text(encoding="utf-8"))
        return {Path(record["image_path"]).stem: record["id"] for record in records}
    # 아직 최신 코드를 받지 않았으면 내려받아 둔 작품 사진 이름으로 폴더를 만든다.
    return {path.stem: path.stem for path in sorted((BACKEND / "data" / "artworks").glob("*.jpg"))}


def download(url, path):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=120) as response:
        path.write_bytes(response.read())


def main():
    for name in registered_folders():
        (EVAL_DIR / "registered" / name).mkdir(parents=True, exist_ok=True)
    for name in ("unregistered", "not_artwork", "unregistered_originals"):
        (EVAL_DIR / name).mkdir(parents=True, exist_ok=True)

    failed = []
    for index, item in enumerate(UNREGISTERED, 1):
        target = EVAL_DIR / "unregistered_originals" / f"{item['file']}.jpg"
        print(f"[{index:2d}/{len(UNREGISTERED)}] {target.name} ... ", end="", flush=True)
        if target.exists():
            print("이미 있음")
            continue
        try:
            download(f"{item['iiif']}/full/!2000,2000/0/default.jpg", target)
            print("완료")
        except Exception as exc:  # 한 작품이 실패해도 나머지는 계속 받는다
            print(f"실패 - {exc}")
            failed.append(target.name)
        time.sleep(1)

    print(f"\n평가 폴더: {EVAL_DIR}")
    print(f"등록 작품 폴더 {len(registered_folders())}개를 만들었습니다.")
    print(f"미등록 작품 원본: 성공 {len(UNREGISTERED) - len(failed)}점 / 실패 {len(failed)}점")


if __name__ == "__main__":
    main()
