"""국내 작품 카탈로그(catalog.korea.json)를 만든다.

- 작품 정보·한국어 설명문: 국립현대미술관 저작권만료 소장품(공공데이터포털 15064140, 공공누리 제1유형)
- 사진: 위키미디어 공용에서 같은 작품의 퍼블릭 도메인 파일만 사용
  (국립현대미술관 홈페이지 사진은 "무단 이용 금지" 표시가 있어 쓰지 않는다)

사용법 (Backend 폴더):
    ./.venv/bin/python build_korea_catalog.py data/korea/commons-matches.json
    ./.venv/bin/python import_catalog.py catalog.korea.json
"""
import argparse
from io import BytesIO
import json
from pathlib import Path

import httpx
from PIL import Image

HERE = Path(__file__).parent
SOURCE = HERE / "data/korea/mmca-expired.json"
MANIFEST = HERE / "catalog.korea.json"
SOURCES = HERE / "catalog.korea.sources.json"
IMAGE_DIR = Path("data/korea/images")
HEADERS = {"User-Agent": "MoMi-catalog/1.0 (https://github.com/lamyoon815-byte/SWAITHON)"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("matches", type=Path, nargs="?", help="관리번호별 위키미디어 파일 매칭 결과")
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    if args.download_only:
        records = json.loads(MANIFEST.read_text(encoding="utf-8"))
        sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    else:
        works = {w["관리번호"]: w for w in json.loads(SOURCE.read_text(encoding="utf-8"))}
        records, sources = [], {}
        for match in json.loads(args.matches.read_text(encoding="utf-8")):
            pick, work = match.get("match"), works.get(match["관리번호"])
            if not pick or not work:
                continue
            number = work["관리번호"]
            artwork_id = f"mmca-{number}"
            description = (work.get("설명문(국문)") or "").replace("<br>", "\n").strip()
            records.append({
                "id": artwork_id, "title": work["작품명(국문)"].strip(), "original_title": (work.get("작품명(영문)") or "").strip() or None,
                "artist": work["작가명(국문)"], "original_artist": work.get("작가명(영문)") or None,
                "year": work.get("제작연도") or None, "number": number,
                "museum": "국립현대미술관", "museum_id": "mmca", "museum_area": "서울 종로구",
                "background": description[:1500] or None,
                "source_url": pick["page"],
                "license": f"사진: {pick['license']} (Wikimedia Commons) · 작품 정보·설명: 국립현대미술관, 공공누리 제1유형",
                "image_path": str(IMAGE_DIR / f"{artwork_id}.jpg"), "review_status": "pending",
            })
            sources[artwork_id] = pick["thumb"]
    with httpx.Client(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        kept = []
        for record in records:
            path = HERE / record["image_path"]
            if not path.exists():
                try:
                    response = client.get(sources[record["id"]]); response.raise_for_status()
                    image = Image.open(BytesIO(response.content)).convert("RGB")
                except (httpx.HTTPError, OSError):
                    print("이미지 실패:", record["id"]); continue
                image.thumbnail((1600, 1600)); path.parent.mkdir(parents=True, exist_ok=True)
                image.save(path, "JPEG", quality=88)
            kept.append(record)
    for record in kept:
        if record["background"] is None:
            del record["background"]
        if record["original_title"] is None:
            del record["original_title"]
    if not args.download_only:
        MANIFEST.write_text(json.dumps(kept, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        SOURCES.write_text(json.dumps({r["id"]: sources[r["id"]] for r in kept}, indent=1) + "\n", encoding="utf-8")
    print(f"국내 작품 {len(kept)}점")


if __name__ == "__main__":
    main()
