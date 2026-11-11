"""미술관 3곳(Met·AIC·NGA)의 퍼블릭 도메인 작품 21점을 내려받아 Backend/data/artworks에 저장한다.

실행 (MoMi 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\download_artworks.py

- import만으로는 아무것도 내려받지 않는다. (main에서만 실행)
- Met·AIC는 실행할 때 각 미술관 API로 퍼블릭 도메인 여부를 다시 확인하고, 아니면 저장하지 않는다.
- NGA는 NGA 공개 데이터셋(openaccess=1)에서 확인한 IIIF 주소를 사용한다.
- 이미지는 긴 변 2000px 이하 JPEG로 저장하고, 출처 목록 sources.csv를 같이 만든다.
"""
import argparse
import csv
import json
import sys
import time
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_SIDE = 2000
USER_AGENT = "MoMi-student-project/1.0 (+https://github.com/lamyoon815-byte/SWAITHON)"

MUSEUMS = {
    "met": "메트로폴리탄 미술관",
    "aic": "시카고 미술관",
    "nga": "내셔널 갤러리 오브 아트",
}

# key: Met = Object ID, AIC = artwork ID, NGA = IIIF 이미지 주소
ARTWORKS = [
    # ---------------- 메트로폴리탄 미술관 (Met) ----------------
    {"file": "met_wheat-field-with-cypresses", "museum_id": "met", "key": 436535, "number": "1993.132",
     "title": "Wheat Field with Cypresses", "artist": "Vincent van Gogh", "year": "1889",
     "reason": "노랑 밀밭, 초록 사이프러스, 파란 하늘이 섞여 적록·청황 색각이상 모두 색 구분이 어려움"},
    {"file": "met_ia-orana-maria", "museum_id": "met", "key": 438821, "number": "51.112.2",
     "title": "Ia Orana Maria (Hail Mary)", "artist": "Paul Gauguin", "year": "1891",
     "reason": "빨간 천과 초록 잎이 맞닿아 있어 적록 색각이상이 경계를 구분하기 어려움"},
    {"file": "met_the-repast-of-the-lion", "museum_id": "met", "key": 438822, "number": "51.112.5",
     "title": "The Repast of the Lion", "artist": "Henri Rousseau", "year": "ca. 1907",
     "reason": "빽빽한 초록 잎 사이의 빨강·주황 꽃과 열매가 적록 색각이상에게 묻혀 보임"},
    {"file": "met_under-the-wave-off-kanagawa", "museum_id": "met", "key": 45434, "number": "JP1847",
     "title": "Under the Wave off Kanagawa (The Great Wave)", "artist": "Katsushika Hokusai", "year": "ca. 1830–32",
     "reason": "파랑 계열 위주라 청황 색각이상에 불리하고, 목판화의 가는 윤곽선이 많음"},
    {"file": "met_melencolia-i", "museum_id": "met", "key": 336228, "number": "43.106.1",
     "title": "Melencolia I", "artist": "Albrecht Dürer", "year": "1514",
     "reason": "동판화의 아주 가는 선으로만 형태를 표현해 윤곽선 강조가 필요함"},
    {"file": "met_circus-sideshow", "museum_id": "met", "key": 437654, "number": "61.101.17",
     "title": "Circus Sideshow (Parade de cirque)", "artist": "Georges Seurat", "year": "1887–88",
     "reason": "어두운 밤 장면이라 명암 대비가 낮아 밝기·대비 보정이 필요함"},
    {"file": "met_the-harvesters", "museum_id": "met", "key": 435809, "number": "19.164",
     "title": "The Harvesters", "artist": "Pieter Bruegel the Elder", "year": "1565",
     "reason": "작은 인물과 세부가 많고 노랑·초록이 섞여 선명도 보정과 색 구분 보조가 필요함"},

    # ---------------- 시카고 미술관 (AIC) ----------------
    {"file": "aic_a-sunday-on-la-grande-jatte", "museum_id": "aic", "key": 27992, "number": "1926.224",
     "title": "A Sunday on La Grande Jatte — 1884", "artist": "Georges Seurat", "year": "1884–86",
     "reason": "빨강·초록 점을 나란히 찍은 점묘법이라 적록 색각이상에게 색이 뭉개져 보임"},
    {"file": "aic_the-bedroom", "museum_id": "aic", "key": 28560, "number": "1926.417",
     "title": "The Bedroom", "artist": "Vincent van Gogh", "year": "1889",
     "reason": "빨간 이불과 초록 창문 등 보색 대비로 그려져 적록 색각이상에 불리함"},
    {"file": "aic_paris-street-rainy-day", "museum_id": "aic", "key": 20684, "number": "1964.336",
     "title": "Paris Street; Rainy Day", "artist": "Gustave Caillebotte", "year": "1877",
     "reason": "회색조 위주라 명암 대비가 낮아 저시력 사용자가 형태를 구분하기 어려움"},
    {"file": "aic_at-the-moulin-rouge", "museum_id": "aic", "key": 61128, "number": "1928.610",
     "title": "At the Moulin Rouge", "artist": "Henri de Toulouse-Lautrec", "year": "1892–95",
     "reason": "초록빛 얼굴과 주황 머리, 어두운 실내가 섞여 색 구분과 명암 보정이 모두 필요함"},
    {"file": "aic_water-lilies", "museum_id": "aic", "key": 16568, "number": "1933.1157",
     "title": "Water Lilies", "artist": "Claude Monet", "year": "1906",
     "reason": "분홍 수련이 초록·파랑 수면 위에 있어 적록 색각이상에게 꽃이 잘 구분되지 않음"},
    {"file": "aic_a-mild-breeze-on-a-fine-day", "museum_id": "aic", "key": 77328, "number": "1952.341",
     "title": "A Mild Breeze on a Fine Day (Red Fuji)", "artist": "Katsushika Hokusai", "year": "c. 1830–33",
     "reason": "붉은 산과 아래쪽 초록 숲의 경계가 적록 색각이상에게 흐려 보이고, 목판화 선이 가늚"},
    {"file": "aic_sudden-shower-over-shin-ohashi-bridge", "museum_id": "aic", "key": 26545, "number": "1925.3742",
     "title": "Sudden Shower over Shin Ohashi Bridge and Atake", "artist": "Utagawa Hiroshige", "year": "1857",
     "reason": "아주 가는 빗줄기 선으로 비를 표현해 윤곽선 강조가 필요함"},

    # ---------------- 내셔널 갤러리 오브 아트 (NGA) ----------------
    {"file": "nga_farmhouse-in-provence", "museum_id": "nga", "number": "1970.17.34",
     "key": "https://api.nga.gov/iiif/51c369a2-cc20-43f6-8262-25877c4377eb",
     "source_url": "https://www.nga.gov/artworks/52178-farmhouse-provence",
     "title": "Farmhouse in Provence", "artist": "Vincent van Gogh", "year": "1888",
     "reason": "빨강과 초록의 보색 대비로 구성되어 적록 색각이상에게 대비가 사라져 보임"},
    {"file": "nga_roses", "museum_id": "nga", "number": "1991.67.1",
     "key": "https://api.nga.gov/iiif/bef8c58d-15ae-4649-b2ff-ae0ead24714e",
     "source_url": "https://www.nga.gov/artworks/72328-roses",
     "title": "Roses", "artist": "Vincent van Gogh", "year": "1890",
     "reason": "옅은 분홍 장미가 초록 배경 위에 있어 적록 색각이상에게 꽃과 배경이 비슷해 보임"},
    {"file": "nga_a-girl-with-a-watering-can", "museum_id": "nga", "number": "1963.10.206",
     "key": "https://api.nga.gov/iiif/bcc517e0-84c3-4e21-8c08-c9a0181ced29",
     "source_url": "https://www.nga.gov/artworks/46681-girl-watering-can",
     "title": "A Girl with a Watering Can", "artist": "Auguste Renoir", "year": "1876",
     "reason": "빨간 꽃과 초록 정원이 섞여 있어 적록 색각이상에게 꽃이 잘 보이지 않음"},
    {"file": "nga_woman-with-a-parasol", "museum_id": "nga", "number": "1983.1.29",
     "key": "https://api.nga.gov/iiif/99758d9d-c10b-4d02-a198-7e49afb1f3a6",
     "source_url": "https://www.nga.gov/collection/art-object-page.61379.html",
     "title": "Woman with a Parasol - Madame Monet and Her Son", "artist": "Claude Monet", "year": "1875",
     "reason": "파랑 하늘, 초록 풀밭, 노란빛이 섞여 청황 색각이상에게 색 구분이 어려움"},
    {"file": "nga_symphony-in-white-no-1", "museum_id": "nga", "number": "1943.6.2",
     "key": "https://api.nga.gov/iiif/4133ddae-6de0-4e9f-8ded-a43b2ac6c8c1",
     "source_url": "https://www.nga.gov/artworks/12198-symphony-white-no-1-white-girl",
     "title": "Symphony in White, No. 1: The White Girl", "artist": "James McNeill Whistler", "year": "1861-1863, 1872",
     "reason": "흰 옷과 흰 배경이 겹쳐 명암 대비가 매우 낮아 윤곽선·대비 보정이 필요함"},
    {"file": "nga_woman-holding-a-balance", "museum_id": "nga", "number": "1942.9.97",
     "key": "https://api.nga.gov/iiif/c948cf32-e6c7-41a0-a053-0ad0562960c4",
     "source_url": "https://www.nga.gov/artworks/1236-woman-holding-balance",
     "title": "Woman Holding a Balance", "artist": "Johannes Vermeer", "year": "c. 1664",
     "reason": "어두운 실내 장면이라 밝기·대비 보정 없이는 세부가 잘 보이지 않음"},
    {"file": "nga_the-three-crosses", "museum_id": "nga", "number": "1943.3.9115",
     "key": "https://api.nga.gov/iiif/666b1ed5-e0d3-4936-9249-2a92a4b59944",
     "source_url": "https://www.nga.gov/artworks/11624-christ-crucified-between-two-thieves-three-crosses",
     "title": "Christ Crucified between the Two Thieves (The Three Crosses)", "artist": "Rembrandt van Rijn", "year": "1653",
     "reason": "드라이포인트 판화의 가는 선으로 그려져 윤곽선 강조가 필요함"},
]

LICENSE = {
    "met": "Public Domain (The Met Open Access, CC0)",
    "aic": "CC0 Public Domain Designation",
    "nga": "NGA Open Access (CC0)",
}


def fetch(url, accept=None, timeout=120):
    headers = {"User-Agent": USER_AGENT}
    if "artic.edu" in url:
        headers["AIC-User-Agent"] = USER_AGENT
    if accept:
        headers["Accept"] = accept
    with urlopen(Request(url, headers=headers), timeout=timeout) as response:
        return response.read()


def resolve_met(item):
    """Met API로 퍼블릭 도메인 여부와 원본 이미지 주소를 확인한다."""
    data = json.loads(fetch(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{item['key']}"))
    if data.get("isPublicDomain") is not True:
        raise ValueError("Met API에서 퍼블릭 도메인이 아니라고 응답함")
    candidates = [url for url in (data.get("primaryImage"), data.get("primaryImageSmall")) if url]
    if not candidates:
        raise ValueError("Met API에 공개 이미지 주소가 없음")
    source_url = data.get("objectURL") or f"https://www.metmuseum.org/art/collection/search/{item['key']}"
    return candidates, source_url


def resolve_aic(item):
    """AIC API로 퍼블릭 도메인 여부와 IIIF 이미지 주소를 확인한다."""
    data = json.loads(fetch(
        f"https://api.artic.edu/api/v1/artworks/{item['key']}?fields=id,title,is_public_domain,image_id"))
    artwork = data["data"]
    if artwork.get("is_public_domain") is not True:
        raise ValueError("AIC API에서 퍼블릭 도메인이 아니라고 응답함")
    if not artwork.get("image_id"):
        raise ValueError("AIC API에 이미지 ID가 없음")
    base = data.get("config", {}).get("iiif_url", "https://www.artic.edu/iiif/2")
    image = f"{base}/{artwork['image_id']}"
    # 퍼블릭 도메인 작품은 1686px까지 허용, 실패하면 권장 크기 843px
    candidates = [f"{image}/full/1686,/0/default.jpg", f"{image}/full/843,/0/default.jpg"]
    return candidates, f"https://www.artic.edu/artworks/{item['key']}"


def resolve_nga(item):
    base = item["key"]
    candidates = [f"{base}/full/!{MAX_SIDE},{MAX_SIDE}/0/default.jpg", f"{base}/full/{MAX_SIDE},/0/default.jpg"]
    return candidates, item["source_url"]


RESOLVERS = {"met": resolve_met, "aic": resolve_aic, "nga": resolve_nga}


def save_jpeg(raw, path):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None  # 미술관 원본은 매우 커서 기본 제한을 넘을 수 있음
    with Image.open(BytesIO(raw)) as image:
        image.draft("RGB", (MAX_SIDE, MAX_SIDE))  # JPEG는 축소해서 읽어 메모리 절약
        rgb = image.convert("RGB")
    rgb.thumbnail((MAX_SIDE, MAX_SIDE))
    rgb.save(path, format="JPEG", quality=92)
    return rgb.size


def download(item, out_dir):
    candidates, source_url = RESOLVERS[item["museum_id"]](item)
    last_error = None
    for url in candidates:
        try:
            raw = fetch(url, accept="image/jpeg,image/*")
            size = save_jpeg(raw, out_dir / f"{item['file']}.jpg")
            return source_url, url, size
        except (HTTPError, URLError, OSError) as exc:
            last_error = exc
            time.sleep(1)
    raise RuntimeError(f"이미지 다운로드 실패: {last_error}")


def main():
    parser = argparse.ArgumentParser(description="미술관 3곳의 퍼블릭 도메인 작품 21점 다운로드")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "artworks")
    parser.add_argument("--dry-run", action="store_true", help="내려받지 않고 목록만 출력")
    args = parser.parse_args()

    if args.dry_run:
        for item in ARTWORKS:
            print(f"{item['file']}.jpg  ({MUSEUMS[item['museum_id']]} {item['number']})")
        print(f"총 {len(ARTWORKS)}점 → 저장 위치: {args.out}")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    rows, failed = [], []
    for index, item in enumerate(ARTWORKS, 1):
        target = args.out / f"{item['file']}.jpg"
        print(f"[{index:2d}/{len(ARTWORKS)}] {target.name} ... ", end="", flush=True)
        try:
            source_url, image_url, size = download(item, args.out)
            print(f"완료 {size[0]}x{size[1]}")
            rows.append({
                "file": target.name, "museum_id": item["museum_id"], "museum": MUSEUMS[item["museum_id"]],
                "number": item["number"], "title": item["title"], "artist": item["artist"], "year": item["year"],
                "source_url": source_url, "image_url": image_url, "license": LICENSE[item["museum_id"]],
                "reason": item["reason"],
            })
        except Exception as exc:  # 한 작품이 실패해도 나머지는 계속 받는다
            print(f"실패 - {exc}")
            failed.append(target.name)
        time.sleep(1)  # AIC 권장: 이미지 요청 사이 약 1초 간격

    with (args.out / "sources.csv").open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]) if rows else ["file"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n저장 위치: {args.out}")
    print(f"성공 {len(rows)}점 / 실패 {len(failed)}점")
    if failed:
        print("실패한 파일: " + ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
