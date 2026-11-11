"""CC0(자유 이용) 회화를 미술관 공개 API에서 모아 등록용 카탈로그를 만든다.

사용법 (Backend 폴더에서):
    ./.venv/bin/python fetch_open_access.py --per-museum 100      # 메타데이터 수집·한국어 표기·이미지 다운로드
    ./.venv/bin/python fetch_open_access.py --download-only       # 커밋된 카탈로그의 이미지만 다시 받기
    ./.venv/bin/python import_catalog.py catalog.open-access.json
    ./.venv/bin/python build_index.py

- 시카고 미술관(AIC): is_public_domain 회화, 대표작 순. description은 CC BY 4.0이라 출처를 license에 남긴다.
- 메트로폴리탄(Met): 유럽 회화 대표작 중 isPublicDomain. 해설 글은 API에 없다.
- 클리블랜드 미술관(CMA): CC0 회화, 대표작(highlight) 우선.
이미지는 data/open-access/(git 제외)에 긴 변 1600px JPEG로 저장한다.
제목·작가의 한국어 표기는 Gemini(GEMINI_API_KEY, GEMINI_MODEL)로 만든다.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from io import BytesIO
import json
import os
from pathlib import Path
import re
import time

from dotenv import load_dotenv
import httpx
from PIL import Image

HERE = Path(__file__).parent
MANIFEST = HERE / "catalog.open-access.json"
SOURCES = HERE / "catalog.open-access.sources.json"  # 작품 id → 원본 이미지 URL (카탈로그 스키마 밖이라 따로 둔다)
EXISTING = [HERE / "catalog.artworks.json"]
IMAGE_DIR = Path("data/open-access")
MAX_SIDE = 1600
HEADERS = {"User-Agent": "MoMi-catalog/1.0 (student accessibility project)",
           "AIC-User-Agent": "MoMi-catalog/1.0 (student accessibility project)"}

MUSEUMS = {
    "aic": {"museum": "시카고 미술관", "museum_area": "미국 시카고",
            "license": "CC0 Public Domain Designation (설명문: Art Institute of Chicago, CC BY 4.0)"},
    "met": {"museum": "메트로폴리탄 미술관", "museum_area": "미국 뉴욕",
            "license": "Public Domain (The Met Open Access, CC0)"},
    "cma": {"museum": "클리블랜드 미술관", "museum_area": "미국 클리블랜드",
            "license": "CC0 (Cleveland Museum of Art Open Access)"},
}


def clean(text, limit=1200):
    """HTML을 걷어 내고 해설 참고용으로 적당한 길이까지 자른다."""
    if not text:
        return None
    text = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", text))).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(". ", 1)[0] + "."
    return text or None


def get_json(client, url, method="GET", **kwargs):
    for attempt in range(4):
        response = client.request(method, url, **kwargs)
        if response.status_code not in (403, 429, 502, 503) or attempt == 3:
            break
        time.sleep(5 * (attempt + 1))
    response.raise_for_status()
    return response.json()


def fetch_aic(client, limit):
    """AIC 검색은 결과 1,000건(10페이지)까지만 넘길 수 있어 제작 연도 구간별로 나눠 받는다."""
    eras = [(None, 1600), (1600, 1750), (1750, 1830), (1830, 1870), (1870, 1890), (1890, 1910), (1910, None)]
    found, ids = [], set()
    for low, high in eras:
        era = {"range": {"date_end": {k: v for k, v in (("gte", low), ("lt", high)) if v is not None}}}
        query = {"query": {"bool": {"must": [{"term": {"is_public_domain": True}}, {"term": {"artwork_type_id": 1}},
                                             {"exists": {"field": "image_id"}}, era]}},
                 "sort": [{"boost_rank": "asc"}, {"id": "asc"}],
                 "fields": ["id", "title", "artist_title", "date_display", "image_id", "description", "short_description"]}
        for page in range(1, 11):
            try:
                data = get_json(client, "https://api.artic.edu/api/v1/artworks/search", method="POST",
                                json={**query, "limit": 100, "page": page})
            except httpx.HTTPError as exc:
                print(f"  AIC {low}~{high} {page}페이지 실패: {exc}")
                break
            for item in data["data"]:
                if item["id"] in ids or not (item.get("image_id") and item.get("artist_title")):
                    continue
                ids.add(item["id"])
                found.append({"museum_id": "aic", "original_title": item["title"], "original_artist": item["artist_title"],
                              "year": item.get("date_display"),
                              "source_url": f"https://www.artic.edu/artworks/{item['id']}",
                              "background": clean(item.get("description") or item.get("short_description")),
                              "image": f"https://www.artic.edu/iiif/2/{item['image_id']}/full/1686,/0/default.jpg"})
            if page >= data["pagination"]["total_pages"]:
                break
        print(f"  AIC {low}~{high}: 누적 {len(found)}점")
    return found[:limit]


def fetch_met(client, limit):
    """대표작(유럽 회화·미국관)을 먼저, 이어서 유럽 회화 전체를 훑는다. isPublicDomain만 남긴다."""
    queries = [{"departmentId": 11, "isHighlight": "true"}, {"departmentId": 1, "isHighlight": "true"}, {"departmentId": 11}]
    found, seen_ids = [], set()
    for query in queries:
        offset = 0
        while True:
            try:
                data = get_json(client, "https://collectionapi.metmuseum.org/public/collection/v1.1/search",
                                params={"q": "painting", "hasImages": "true", "limit": 500, "offset": offset, **query})
            except httpx.HTTPError as exc:
                print(f"  Met 검색 실패({query}): {exc}")
                break
            ids = data.get("objectIDs") or []
            for object_id in ids:
                if len(found) >= limit:
                    return found
                if object_id in seen_ids:
                    continue
                seen_ids.add(object_id)
                time.sleep(0.4)  # The Met blocks fast clients with 403.
                try:
                    item = get_json(client, f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}")
                except httpx.HTTPError:
                    continue
                if not (item.get("isPublicDomain") and item.get("primaryImage") and item.get("artistDisplayName")):
                    continue
                if "paint" not in (item.get("classification", "") + item.get("medium", "")).lower():
                    continue
                found.append({"museum_id": "met", "original_title": item["title"], "original_artist": item["artistDisplayName"],
                              "year": item.get("objectDate") or None, "source_url": item.get("objectURL"),
                              "background": None, "image": item["primaryImage"]})
                if len(found) % 100 == 0:
                    print(f"  Met {len(found)}점")
            offset += 500
            if not ids or offset >= data.get("total", 0):
                break
    return found


def fetch_cma(client, limit):
    found, skip, urls = [], 0, set()
    for highlight in (1, None):
        skip = 0
        while len(found) < limit:
            params = {"cc0": 1, "type": "Painting", "has_image": 1, "limit": 100, "skip": skip,
                      "fields": "id,title,creators,creation_date,description,wall_description,images,url"}
            if highlight:
                params["highlight"] = 1
            data = get_json(client, "https://openaccess-api.clevelandart.org/api/artworks/", params=params)
            for item in data["data"]:
                image = (item.get("images") or {}).get("print") or (item.get("images") or {}).get("web")
                creators = item.get("creators") or []
                artist = creators[0]["description"].split(" (")[0] if creators else None
                if not (image and artist) or item.get("url") in urls:
                    continue
                urls.add(item.get("url"))
                found.append({"museum_id": "cma", "original_title": item["title"], "original_artist": artist,
                              "year": item.get("creation_date"), "source_url": item.get("url"),
                              "background": clean(item.get("wall_description") or item.get("description")),
                              "image": image["url"]})
            skip += 100
            if not data["data"] or skip >= data["info"]["total"]:
                break
        if len(found) >= limit:
            break
    return found[:limit]


def korean_names(client, items):
    """원제·원어 작가명 → 한국 미술관·교과서에서 흔히 쓰는 한국어 표기. 25점씩 묶어 요청하고 결과를 캐시한다."""
    key, model = os.environ.get("GEMINI_API_KEY", ""), os.environ.get("GEMINI_MODEL", "")
    if not key or not model:
        raise SystemExit("GEMINI_API_KEY와 GEMINI_MODEL이 필요합니다(.env).")
    cache_path = HERE / IMAGE_DIR / "korean-names.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    label = lambda it: f"{it['original_title']}|{it['original_artist']}"
    todo = [i for i, it in enumerate(items) if label(it) not in cache]
    for start in range(0, len(todo), 25):
        batch = [{"i": i, "title": items[i]["original_title"], "artist": items[i]["original_artist"]} for i in todo[start:start + 25]]
        prompt = ("다음 서양 미술 작품의 제목과 작가 이름을 한국 미술관·교과서에서 쓰는 자연스러운 한국어 표기로 옮겨 줘. "
                  "널리 알려진 한국어 제목이 있으면 그것을 쓰고, 작가는 외래어 표기법에 맞춘 전체 이름으로 써. "
                  "JSON 배열만 출력: [{\"i\": 번호, \"title\": \"한국어 제목\", \"artist\": \"한국어 작가명\"}]\n"
                  + json.dumps(batch, ensure_ascii=False))
        body = {"contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}
        try:
            data = get_json(client, f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                            method="POST", params={"key": key}, json=body, timeout=120)
            rows = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            print(f"  한국어 표기 실패(건너뜀): {str(exc)[:120]}")
            continue
        wanted = {b["i"] for b in batch}
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict) and row.get("title") and row.get("artist") and row.get("i") in wanted:
                cache[label(items[int(row["i"])])] = [row["title"].strip(), row["artist"].strip()]
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        print(f"  한국어 표기 {min(start + 25, len(todo))}/{len(todo)}")
    return {i: tuple(cache[label(it)]) for i, it in enumerate(items) if label(it) in cache}


def download(client, url, path):
    if path.exists():
        return True
    try:
        response = client.get(url, timeout=120, follow_redirects=True)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
    except (httpx.HTTPError, OSError):
        return False
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "JPEG", quality=86, optimize=True)
    return True


def existing_state():
    """기존 카탈로그의 원본 URL(중복 제외용)과 미술관별 마지막 번호."""
    urls, last = set(), {}
    for path in EXISTING:
        for record in json.loads(path.read_text(encoding="utf-8")):
            urls.add(record.get("source_url"))
            if record.get("museum_id") and str(record.get("number", "")).isdigit():
                last[record["museum_id"]] = max(last.get(record["museum_id"], 0), int(record["number"]))
    return urls, last


def download_all(client, records, sources):
    failed = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(lambda r: (r["id"], download(client, sources[r["id"]], HERE / r["image_path"])), records)
        for n, (artwork_id, ok) in enumerate(results, 1):
            if not ok:
                failed.append(artwork_id)
            if n % 200 == 0:
                print(f"  이미지 {n}/{len(records)}")
    return failed


def main():
    load_dotenv(HERE / ".env")
    parser = argparse.ArgumentParser(description="CC0 회화를 공개 API에서 모아 카탈로그 생성")
    parser.add_argument("--per-museum", type=int, default=0, help="미술관별 최대 점수 (0이면 전부)")
    parser.add_argument("--reuse-metadata", action="store_true", help="지난번에 모은 작품 목록을 다시 쓰기")
    parser.add_argument("--download-only", action="store_true", help="커밋된 카탈로그의 이미지만 내려받기")
    args = parser.parse_args()
    with httpx.Client(headers=HEADERS, timeout=60) as client:
        if args.download_only:
            records = json.loads(MANIFEST.read_text(encoding="utf-8"))
            sources = json.loads(SOURCES.read_text(encoding="utf-8"))
        else:
            seen, last = existing_state()
            limit = args.per_museum or 10**6
            gathered_path = HERE / IMAGE_DIR / "gathered.json"
            if args.reuse_metadata and gathered_path.exists():
                gathered = json.loads(gathered_path.read_text(encoding="utf-8"))
            else:
                gathered = []
                for museum_id, fetch in (("aic", fetch_aic), ("met", fetch_met), ("cma", fetch_cma)):
                    try:
                        fetched = fetch(client, limit + 10)
                    except httpx.HTTPError as exc:
                        print(f"  {MUSEUMS[museum_id]['museum']} 수집 중단: {exc}")
                        fetched = []
                    items = [i for i in fetched if i["source_url"] not in seen][:limit]
                    print(f"{MUSEUMS[museum_id]['museum']}: {len(items)}점")
                    gathered += items
                gathered_path.parent.mkdir(parents=True, exist_ok=True)
                gathered_path.write_text(json.dumps(gathered, ensure_ascii=False), encoding="utf-8")
            names = korean_names(client, gathered)
            records, sources, counter = [], {}, dict(last)
            for i, item in enumerate(gathered):
                if i not in names:
                    continue
                museum_id = item["museum_id"]
                counter[museum_id] = counter.get(museum_id, 0) + 1
                number = f"{counter[museum_id]:02d}"
                artwork_id = f"{museum_id}-{number}"
                title, artist = names[i]
                records.append({"id": artwork_id, "title": title, "original_title": item["original_title"],
                                "artist": artist, "original_artist": item["original_artist"], "year": item["year"],
                                "number": number, **MUSEUMS[museum_id], "museum_id": museum_id,
                                "background": item["background"], "source_url": item["source_url"],
                                "image_path": str(IMAGE_DIR / f"{artwork_id}.jpg"), "review_status": "pending"})
                sources[artwork_id] = item["image"]
        failed = download_all(client, records, sources)
        records = [r for r in records if r["id"] not in failed]
        if not args.download_only:
            for record in records:
                if record["background"] is None:
                    del record["background"]
            MANIFEST.write_text(json.dumps(records, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            SOURCES.write_text(json.dumps({r["id"]: sources[r["id"]] for r in records}, indent=1) + "\n", encoding="utf-8")
    print(f"완료: {len(records)}점, 이미지 실패 {len(failed)}점 {failed[:10]}")


if __name__ == "__main__":
    main()
