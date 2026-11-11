"""위키미디어 공용 'Paintings from Korea' 분류에서 자유 이용 가능한 한국 회화를 모아 catalog.korea-commons.json을 만든다.

- 라이선스: Public domain / CC0 / CC BY / CC BY-SA 만 (NC·ND 제외). 출처와 라이선스를 license에 남긴다.
- Gemini(GEMINI_API_KEY, GEMINI_MODEL)로 실제 회화 작품 사진인지 거르고, 한국어 제목·작가·연도·소장처를 정리한다.
- 소장처가 확인되면 그 미술관으로, 아니면 '한국 명화 모음'으로 묶는다.

사용법 (Backend 폴더):
    ./.venv/bin/python fetch_korea_commons.py
    ./.venv/bin/python fetch_korea_commons.py --download-only
    ./.venv/bin/python import_catalog.py catalog.korea-commons.json
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
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
MANIFEST = HERE / "catalog.korea-commons.json"
SOURCES = HERE / "catalog.korea-commons.sources.json"
WORK_DIR = HERE / "data/korea/commons"
IMAGE_DIR = Path("data/korea/commons/images")
API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "MoMi-catalog/1.0 (https://github.com/lamyoon815-byte/SWAITHON)"}
ROOT = "Category:Paintings from Korea"
SKIP_CATEGORY = re.compile(r"chunhwa|erotic|body painting|mural|graffiti|tattoo|photograph|people|exhibition", re.I)
FREE = re.compile(r"public domain|^pd|cc0|cc[- ]by(-sa)?[- ]\d", re.I)
NON_FREE = re.compile(r"\bnc\b|\bnd\b|non-?commercial|no ?deriv", re.I)
MUSEUMS = {  # Gemini가 고른 소장처 → (museum_id, 이름, 지역)
    "국립중앙박물관": ("nmk", "국립중앙박물관", "서울 용산구"),
    "간송미술관": ("kansong", "간송미술관", "서울 성북구"),
    "리움미술관": ("leeum", "리움미술관", "서울 용산구"),
    "국립고궁박물관": ("gogung", "국립고궁박물관", "서울 종로구"),
    "국립현대미술관": ("mmca", "국립현대미술관", "서울 종로구"),
}
OTHER = ("korea-classics", "한국 명화 모음", "온라인 소장품")


def api(client, **params):
    for attempt in range(4):
        response = client.post(API, data={"action": "query", "format": "json", **params})
        if response.status_code == 200:
            return response.json()
        time.sleep(3 * (attempt + 1))
    response.raise_for_status()


def walk(client, root, depth=4):
    """분류 트리를 넓게 훑어 파일 제목과 그 파일을 찾은 분류 이름을 모은다."""
    files, seen, frontier = {}, {root}, [root]
    for level in range(depth + 1):
        next_frontier = []
        for category in frontier:
            cont = {}
            while True:
                data = api(client, list="categorymembers", cmtitle=category, cmlimit=500, cmtype="file|subcat", **cont)
                for member in data["query"]["categorymembers"]:
                    title = member["title"]
                    if title.startswith("Category:"):
                        if title not in seen and not SKIP_CATEGORY.search(title):
                            seen.add(title); next_frontier.append(title)
                    else:
                        files.setdefault(title, category)
                if "continue" not in data:
                    break
                cont = data["continue"]
        print(f"  분류 {level}단계: 분류 {len(seen)}개, 파일 {len(files)}개", flush=True)
        frontier = next_frontier
    return files


def details(client, titles):
    result = {}
    for start in range(0, len(titles), 40):
        data = api(client, prop="imageinfo", titles="|".join(titles[start:start + 40]),
                   iiprop="url|extmetadata|mime|size", iiurlwidth=1600)
        for page in data["query"]["pages"].values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            license_name = meta.get("LicenseShortName", {}).get("value", "")
            if not info.get("mime", "").startswith("image/") or info.get("mime") == "image/svg+xml":
                continue
            if not FREE.search(license_name) or NON_FREE.search(license_name):
                continue
            if min(info.get("width", 0), info.get("height", 0)) < 500:
                continue
            clean = lambda key: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", meta.get(key, {}).get("value", ""))).strip()
            result[page["title"]] = {"license": license_name, "image": info.get("thumburl") or info.get("url"),
                                     "page": info.get("descriptionurl"), "description": clean("ImageDescription")[:400],
                                     "artist": clean("Artist")[:120], "date": clean("DateTimeOriginal")[:60],
                                     "credit": clean("Credit")[:160]}
        print(f"  파일 정보 {min(start + 40, len(titles))}/{len(titles)}", flush=True)
    return result


def gemini(client, prompt):
    key, model = os.environ.get("GEMINI_API_KEY", ""), os.environ.get("GEMINI_MODEL", "")
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}}
    for attempt in range(3):
        try:
            response = client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                   params={"key": key}, json=body, timeout=120)
            if response.status_code == 200:
                return json.loads(response.json()["candidates"][0]["content"]["parts"][0]["text"])
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            pass
        time.sleep(4)
    return None


def describe(client, files):
    """20개씩: 실제 한국 회화 작품 사진인지, 한국어 제목·작가·연도·소장처."""
    cache_path = WORK_DIR / "gemini.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    todo = [title for title in files if title not in cache]
    for start in range(0, len(todo), 20):
        batch = [{"file": t, "category": files[t]["category"], "description": files[t]["description"],
                  "artist": files[t]["artist"], "date": files[t]["date"], "credit": files[t]["credit"]} for t in todo[start:start + 20]]
        prompt = ("위키미디어 공용의 한국 회화 파일 목록이야. 각 파일마다 판단해서 JSON 배열만 출력해.\n"
                  "- artwork: 한 점의 회화 작품 전체를 정면에서 찍은 사진이면 true. 부분 확대(detail), 전시장·건물·사람 사진, "
                  "인쇄물·책 표지, 성적인 그림, 같은 작품의 중복 사진이면 false\n"
                  "- title: 한국에서 통용되는 한국어 작품명 (예: 씨름, 인왕제색도, 미인도)\n"
                  "- artist: 한국어 작가명 (미상이면 '작자 미상')\n- year: 제작 연도나 시대 (예: 1751, 18세기, 조선 후기), 모르면 null\n"
                  "- museum: 소장처 한국어 이름. 국립중앙박물관/간송미술관/리움미술관/국립고궁박물관/국립현대미술관 중 하나면 그 이름, "
                  "그 밖이거나 모르면 null\n- note: 작품에 대한 한국어 한두 문장 소개 (근거 없는 내용은 쓰지 말 것)\n"
                  "형식: [{\"file\": ..., \"artwork\": bool, \"title\": ..., \"artist\": ..., \"year\": ..., \"museum\": ..., \"note\": ...}]\n"
                  + json.dumps(batch, ensure_ascii=False))
        rows = gemini(client, prompt)
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict) and row.get("file") in files:
                cache[row["file"]] = row
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        print(f"  작품 정리 {min(start + 20, len(todo))}/{len(todo)}", flush=True)
    return cache


def download(client, url, path):
    if path.exists():
        return True
    for attempt in range(3):
        try:
            response = client.get(url, timeout=120, follow_redirects=True)
            if response.status_code == 429:
                time.sleep(5 * (attempt + 1)); continue
            response.raise_for_status()
            image = Image.open(BytesIO(response.content)).convert("RGB")
            image.thumbnail((1600, 1600)); path.parent.mkdir(parents=True, exist_ok=True)
            image.save(path, "JPEG", quality=86, optimize=True)
            return True
        except (httpx.HTTPError, OSError):
            time.sleep(2)
    return False


def main():
    load_dotenv(HERE / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    with httpx.Client(headers=HEADERS, timeout=60) as client:
        if args.download_only:
            records = json.loads(MANIFEST.read_text(encoding="utf-8"))
            sources = json.loads(SOURCES.read_text(encoding="utf-8"))
        else:
            WORK_DIR.mkdir(parents=True, exist_ok=True)
            found = walk(client, ROOT)
            info = details(client, list(found))
            for title in info:
                info[title]["category"] = found[title]
            print(f"자유 이용 파일 {len(info)}개")
            judged = describe(client, info)
            records, sources, counters, seen_titles = [], {}, {}, set()
            existing = HERE / "catalog.korea.json"  # 국립현대미술관 설명문과 매칭한 작품은 중복으로 넣지 않는다.
            already = {r["source_url"] for r in json.loads(existing.read_text(encoding="utf-8"))} if existing.exists() else set()
            for title, item in info.items():
                row = judged.get(title)
                if not row or not row.get("artwork") or not row.get("title") or item["page"] in already:
                    continue
                key = (row["title"], row.get("artist"))
                if key in seen_titles:
                    continue
                seen_titles.add(key)
                museum_id, museum, area = MUSEUMS.get(row.get("museum") or "", OTHER)
                counters[museum_id] = counters.get(museum_id, 0) + 1
                number = f"{counters[museum_id] + (9000 if museum_id == 'mmca' else 0):02d}"
                artwork_id = f"{museum_id}-c{counters[museum_id]:04d}"
                records.append({"id": artwork_id, "title": row["title"], "artist": row.get("artist") or "작자 미상",
                                "year": row.get("year") or None, "number": number, "museum": museum, "museum_id": museum_id,
                                "museum_area": area, "background": row.get("note") or None, "source_url": item["page"],
                                "license": f"{item['license']} (Wikimedia Commons, {title[5:]})",
                                "image_path": str(IMAGE_DIR / f"{artwork_id}.jpg"), "review_status": "pending"})
                sources[artwork_id] = item["image"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            ok = list(pool.map(lambda r: download(client, sources[r["id"]], HERE / r["image_path"]), records))
        records = [r for r, good in zip(records, ok) if good]
        for record in records:
            for key in ("year", "background"):
                if record.get(key) is None:
                    record.pop(key, None)
        if not args.download_only:
            MANIFEST.write_text(json.dumps(records, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            SOURCES.write_text(json.dumps({r["id"]: sources[r["id"]] for r in records}, indent=1) + "\n", encoding="utf-8")
    by_museum = {}
    for record in records:
        by_museum[record["museum"]] = by_museum.get(record["museum"], 0) + 1
    print(f"완료: {len(records)}점", by_museum)


if __name__ == "__main__":
    main()
