"""작품 분위기 10가지 분류와 분위기별 배경 음악 폴더 만들기.

하는 일
1. 분위기마다 정한 무료 음원(위키미디어 공용, 퍼블릭 도메인·CC0·CC BY) 10곡을 MP3로 내려받는다.
2. 작품 이미지를 CLIP으로 보고 10가지 분위기 중 가장 가까운 것을 고른다(제로샷 분류, 추가 학습 없음).
   - 분위기마다 영어 설명 문장 여러 개의 평균과 이미지의 유사도를 비교한다.
   - 한국 전통 미술관 작품은 '한국·동양 전통' 쪽에 가산점을 준다(그림만으로는 구분이 어려운 경우가 있어서).
3. 결과를 연동 안내(README.txt) 형식인 {artwork_id, music_file}로 저장한다.

음악 10곡은 git에 함께 올리는 Backend/music/ 폴더에 둔다(서버가 이 폴더의 파일을 /music/{분위기}로 보내 준다).
- Backend/music/01_calm.mp3 … 10_korean.mp3 : 분위기별 음악 10곡
- Backend/music/CREDITS.md                  : 음원 출처 표기

분류 결과 폴더 (기본: Backend/data/momi-music, git에 올라가지 않음)
- music_manifest.json : 작품마다 {artwork_id, music_file, category, category_name, confidence}
- categories.json     : 분위기 10가지 설명과 음악 출처·라이선스
- review.csv          : 사람이 훑어볼 분류 결과(확신이 낮은 순으로 정렬)
- embeddings.npz      : 이미지 임베딩 캐시(다시 실행할 때 이어서)

실행 (SWAITHON 폴더에서, 작품 서버와 같은 Wi-Fi):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\mood_music.py --manifest http://172.20.102.74:8004/manifest.json
    # 먼저 50점만 시험: --limit 50
    # 음악 10곡만 먼저 받기: --music-only
    # ZIP을 풀어 둔 경우: --images-dir C:\\경로\\momi-ai-music (manifest의 image_path 기준)
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
# 음악 파일의 기준 폴더. 파일은 MUSIC_ROOT / music_file(...) = Backend/music/01_calm.mp3 …
MUSIC_ROOT = BACKEND


def _use_backend_imports():
    """스크립트로 실행할 때만 Backend 폴더 기준으로 import한다(서버가 이 모듈을 불러올 때는 sys.path를 건드리지 않음)."""
    here = Path(__file__).resolve().parent
    sys.path[:] = [entry for entry in sys.path if Path(entry or ".").resolve() != here]
    sys.path.insert(0, str(BACKEND))

USER_AGENT = "MoMi-SWAITHON/1.0 (student art accessibility app; mood music setup)"
LOGIT_SCALE = 100.0  # CLIP 학습 때 쓰는 값. 유사도 차이를 확률로 바꿀 때 쓴다.
KOREAN_TRADITIONAL_MUSEUMS = {"nmk", "kansong", "gogung", "korea-classics"}
KOREAN_BONUS = 0.03  # 코사인 유사도에 더하는 값(로짓으로 3)

COMMONS = "https://upload.wikimedia.org/wikipedia/commons"
CATEGORIES = [
    {"key": "calm", "name": "평온·고요", "description": "조용한 실내, 정물, 잔잔한 풍경",
     "prompts": ["a calm, quiet and peaceful painting", "a serene still life", "a tranquil, silent interior",
                 "a still and peaceful scene with soft light"],
     "track": {"title": "짐노페디 1번", "composer": "에리크 사티", "performer": "Robin Alciatore (Musopen)",
               "license": "Public domain",
               "page": "https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg",
               "mp3": f"{COMMONS}/transcoded/9/90/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg.mp3"}},
    {"key": "lyrical", "name": "서정·우아", "description": "인물화, 우아한 여인, 낭만적인 장면",
     "prompts": ["an elegant portrait of a person", "a graceful and romantic painting of a woman",
                 "a tender, gentle portrait", "a refined portrait in elegant clothes"],
     "track": {"title": "녹턴 2번 내림마장조 작품 9", "composer": "프레데리크 쇼팽", "performer": "Peter Johnston (Musopen)",
               "license": "CC0",
               "page": "https://commons.wikimedia.org/wiki/File:Chopin_Nocturne_No._2_in_E_Flat_Major,_Op._9.ogg",
               "mp3": f"{COMMONS}/transcoded/0/04/Chopin_Nocturne_No._2_in_E_Flat_Major%2C_Op._9.ogg/Chopin_Nocturne_No._2_in_E_Flat_Major%2C_Op._9.ogg.mp3"}},
    {"key": "bright", "name": "밝음·생기", "description": "햇살, 꽃, 축제, 즐거운 사람들",
     "prompts": ["a bright, cheerful and sunny painting", "a joyful, colorful scene with flowers",
                 "happy people enjoying a lively day outdoors", "a festive, lively celebration"],
     "track": {"title": "사계 중 봄 1악장", "composer": "안토니오 비발디", "performer": "The Modena Chamber Orchestra (Musopen)",
               "license": "Public domain (Public Domain Mark)",
               "page": "https://commons.wikimedia.org/wiki/File:The_Modena_Chamber_Orchestra_-_Vivaldi%27s_Spring,_RV_269_-_I._Allegro.ogg",
               "mp3": f"{COMMONS}/transcoded/1/18/The_Modena_Chamber_Orchestra_-_Vivaldi%27s_Spring%2C_RV_269_-_I._Allegro.ogg/The_Modena_Chamber_Orchestra_-_Vivaldi%27s_Spring%2C_RV_269_-_I._Allegro.ogg.mp3"}},
    {"key": "pastoral", "name": "목가·자연", "description": "들판, 숲, 강, 농촌, 아침 풍경",
     "prompts": ["a pastoral landscape with fields and trees", "a peaceful countryside with farms",
                 "a river and forest in nature", "a sunrise over a green landscape"],
     "track": {"title": "페르 귄트 모음곡 1번 중 아침", "composer": "에드바르 그리그", "performer": "Musopen Symphony Orchestra",
               "license": "Public domain",
               "page": "https://commons.wikimedia.org/wiki/File:Musopen_-_Morning.ogg",
               "mp3": f"{COMMONS}/transcoded/1/1a/Musopen_-_Morning.ogg/Musopen_-_Morning.ogg.mp3"}},
    {"key": "sacred", "name": "경건·성스러움", "description": "종교화, 성인, 천사, 성모자, 제단화",
     "prompts": ["a religious painting of saints and angels", "the Virgin Mary holding the Christ child",
                 "a holy Christian altarpiece with gold", "a devotional scene of prayer"],
     "track": {"title": "칸타타 147번 중 '예수는 나의 기쁨'", "composer": "요한 제바스티안 바흐", "performer": "Orchestra Gli Armonici (Musopen)",
               "license": "CC0",
               "page": "https://commons.wikimedia.org/wiki/File:Bach,_BWV_147,_10._Jesus_bleibet_meine_Freude.ogg",
               "mp3": f"{COMMONS}/transcoded/2/27/Bach%2C_BWV_147%2C_10._Jesus_bleibet_meine_Freude.ogg/Bach%2C_BWV_147%2C_10._Jesus_bleibet_meine_Freude.ogg.mp3"}},
    {"key": "majestic", "name": "장엄·웅장", "description": "왕과 귀족, 궁전, 역사화, 큰 건축물",
     "prompts": ["a grand and majestic historical painting", "a portrait of a king or a noble in rich robes",
                 "a magnificent palace or cathedral", "a monumental scene of royalty and ceremony"],
     "track": {"title": "수상 음악 중 알라 혼파이프", "composer": "게오르크 프리드리히 헨델",
               "performer": "Marine Chamber Orchestra, United States Marine Band", "license": "Public domain",
               "page": "https://commons.wikimedia.org/wiki/File:Handel%27s_Water_Music_-_12._Alla_hornpipe_-_Chamber_Orchestra_-_United_States_Marine_Band.opus",
               "mp3": f"{COMMONS}/transcoded/5/5c/Handel%27s_Water_Music_-_12._Alla_hornpipe_-_Chamber_Orchestra_-_United_States_Marine_Band.opus/Handel%27s_Water_Music_-_12._Alla_hornpipe_-_Chamber_Orchestra_-_United_States_Marine_Band.opus.mp3"}},
    {"key": "melancholy", "name": "슬픔·애수", "description": "이별, 죽음, 외로움, 쓸쓸한 장면",
     "prompts": ["a sad and melancholic painting", "a lonely figure in grief", "a somber scene of mourning",
                 "a gloomy, muted and sorrowful scene"],
     "track": {"title": "페르 귄트 모음곡 1번 중 오세의 죽음", "composer": "에드바르 그리그", "performer": "Musopen Symphony Orchestra",
               "license": "CC0",
               "page": "https://commons.wikimedia.org/wiki/File:Peer_Gynt_Suite_No._1,_Op._46_-_II._Aase%27s_Death.ogg",
               "mp3": f"{COMMONS}/transcoded/2/26/Peer_Gynt_Suite_No._1%2C_Op._46_-_II._Aase%27s_Death.ogg/Peer_Gynt_Suite_No._1%2C_Op._46_-_II._Aase%27s_Death.ogg.mp3"}},
    {"key": "dramatic", "name": "긴장·극적", "description": "전투, 폭풍, 사냥, 강한 명암의 사건",
     "prompts": ["a dramatic battle scene", "a stormy sea with huge waves", "a violent and tense struggle",
                 "a dark dramatic scene with strong contrast of light and shadow"],
     "track": {"title": "페르 귄트 모음곡 1번 중 산왕의 궁전에서", "composer": "에드바르 그리그", "performer": "Musopen Symphony Orchestra",
               "license": "Public domain",
               "page": "https://commons.wikimedia.org/wiki/File:Musopen_-_In_the_Hall_Of_The_Mountain_King.ogg",
               "mp3": f"{COMMONS}/transcoded/b/bb/Musopen_-_In_the_Hall_Of_The_Mountain_King.ogg/Musopen_-_In_the_Hall_Of_The_Mountain_King.ogg.mp3"}},
    {"key": "dreamy", "name": "몽환·신비", "description": "밤, 달빛, 안개, 신화와 상상의 장면",
     "prompts": ["a dreamy and mysterious night scene", "moonlight over water", "a misty, hazy impressionist painting",
                 "a mythological fantasy scene"],
     "track": {"title": "베르가마스크 모음곡 중 달빛", "composer": "클로드 드뷔시", "performer": "Laurens Goedhart",
               "license": "Public domain",
               "page": "https://commons.wikimedia.org/wiki/File:Clair_de_lune_(Claude_Debussy)_Suite_bergamasque.ogg",
               "mp3": f"{COMMONS}/transcoded/b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg.mp3"}},
    {"key": "korean", "name": "한국·동양 전통", "description": "수묵화, 산수화, 민화, 도자기 등 동양 전통 미술",
     "prompts": ["a traditional Korean painting", "an East Asian ink wash landscape painting",
                 "a traditional Korean folk painting", "an Asian hanging scroll painting with calligraphy"],
     "track": {"title": "국악연주곡 구아리랑", "composer": "한국 민요", "performer": "한국저작권위원회 (공유마당)",
               "license": "CC BY 4.0",
               "page": "https://commons.wikimedia.org/wiki/File:Old_Arirang.wav",
               "mp3": f"{COMMONS}/transcoded/a/a4/Old_Arirang.wav/Old_Arirang.wav.mp3",
               "attribution": "국악연주곡 구아리랑, 한국저작권위원회, 공유마당, CC BY 4.0"}},
]


def music_file(index, category):
    return f"music/{index + 1:02d}_{category['key']}.mp3"


def fetch(url, timeout=30):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
        return response.read()


def looks_like_mp3(data: bytes):
    return len(data) > 100_000 and (data[:3] == b"ID3" or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0))


def fetch_with_retry(url, fetcher=fetch, tries=4, wait=5):
    """위키미디어가 잠깐 막거나(429·503) 느릴 때를 위해 간격을 늘려 가며 다시 받는다."""
    from urllib.error import HTTPError
    for attempt in range(1, tries + 1):
        try:
            return fetcher(url, 180)
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == tries:
                raise
            delay = int(error.headers.get("Retry-After") or wait * attempt * 2)
        except (TimeoutError, OSError):
            if attempt == tries:
                raise
            delay = wait * attempt * 2
        print(f"    잠시 후 다시 받습니다 ({attempt}/{tries - 1}, {delay}초 대기)")
        time.sleep(delay)


def download_music(out: Path, fetcher=fetch):
    """10곡을 받는다. 한 곡이 실패해도 나머지는 계속 받고, 마지막에 실패한 곡을 알려 준다."""
    (out / "music").mkdir(parents=True, exist_ok=True)
    failed = []
    for index, category in enumerate(CATEGORIES):
        path = out / music_file(index, category)
        if path.exists() and looks_like_mp3(path.read_bytes()):
            continue
        try:
            data = fetch_with_retry(category["track"]["mp3"], fetcher)
        except Exception as error:
            failed.append(category)
            print(f"  ✗ {path.name} 받기 실패 ({type(error).__name__}: {str(error)[:120]})")
            continue
        if not looks_like_mp3(data):
            failed.append(category)
            print(f"  ✗ {path.name}: MP3가 아닌 응답을 받았습니다 ({category['track']['page']})")
            continue
        path.write_bytes(data)
        print(f"  음악 {path.name} ({len(data) / 1e6:.1f}MB) ← {category['track']['title']}")
        time.sleep(3)  # 위키미디어 서버에 부담을 주지 않도록 곡 사이에 쉰다.
    (out / "music" / "CREDITS.md").write_text(credits_markdown(), encoding="utf-8")
    ready = sum(1 for i, c in enumerate(CATEGORIES) if (out / music_file(i, c)).exists())
    print(f"  음악 {ready}/10곡 준비")
    if failed:
        raise SystemExit("받지 못한 곡: " + ", ".join(f"{c['key']}({c['track']['title']})" for c in failed)
                         + "\n몇 분 뒤 같은 명령을 다시 실행하면 받은 곡은 건너뛰고 나머지만 받습니다.")


def category_matrix(encoder):
    """분위기마다 설명 문장 임베딩의 평균(정규화) → (10, D)."""
    rows = []
    for category in CATEGORIES:
        vectors = encoder.encode_texts(category["prompts"])
        mean = vectors.mean(axis=0)
        rows.append(mean / max(np.linalg.norm(mean), 1e-12))
    return np.stack(rows).astype(np.float32)


def classify(image_vector, matrix, museum_id=None):
    """(분위기 번호, 확률들). 확률은 10가지 합이 1."""
    similarity = matrix @ image_vector
    if museum_id in KOREAN_TRADITIONAL_MUSEUMS:
        similarity = similarity.copy()
        similarity[[c["key"] for c in CATEGORIES].index("korean")] += KOREAN_BONUS
    logits = LOGIT_SCALE * similarity
    probs = np.exp(logits - logits.max())
    probs /= probs.sum()
    return int(probs.argmax()), probs


def load_manifest(source):
    if str(source).startswith(("http://", "https://")):
        data = json.loads(fetch(str(source), 60))
    else:
        data = json.loads(Path(source).read_text(encoding="utf-8"))
    return data["items"] if isinstance(data, dict) else data


def image_bytes(item, images_dir, fetcher=fetch):
    if images_dir:
        return (Path(images_dir) / item["image_path"]).read_bytes()
    return fetcher(item["image_url"], 30)


def encode_all(items, encoder, out: Path, images_dir=None, fetcher=fetch, workers=6):
    """이미지 임베딩을 만든다. embeddings.npz에 sha256(없으면 id) 기준으로 저장해 이어서 실행할 수 있다."""
    cache_path = out / "embeddings.npz"
    cache = {}
    if cache_path.exists():
        with np.load(cache_path) as saved:
            cache = {key: saved[key] for key in saved.files}
    key = lambda item: item.get("sha256") or item["id"]
    todo = [item for item in items if key(item) not in cache]
    failed = []

    def load(item):
        try:
            return item, image_bytes(item, images_dir, fetcher)
        except Exception as error:  # 이미지 하나 실패로 전체를 멈추지 않는다.
            return item, error

    started = time.time()
    with ThreadPoolExecutor(workers) as pool:
        for done, (item, content) in enumerate(pool.map(load, todo), 1):
            if isinstance(content, Exception):
                failed.append((item["id"], str(content)[:120]))
                continue
            try:
                cache[key(item)] = encoder.encode(content)
            except Exception as error:
                failed.append((item["id"], str(error)[:120]))
            if done % 200 == 0 or done == len(todo):
                np.savez(cache_path, **cache)
                rate = done / max(time.time() - started, 1e-6)
                print(f"  이미지 {done}/{len(todo)} · 초당 {rate:.1f}장 · 남은 시간 약 {(len(todo) - done) / max(rate, 1e-6) / 60:.0f}분")
    if todo:
        np.savez(cache_path, **cache)
    return {item["id"]: cache[key(item)] for item in items if key(item) in cache}, failed


def write_outputs(out: Path, items, vectors, matrix, failed):
    results, counts = [], {c["key"]: 0 for c in CATEGORIES}
    for item in items:
        if item["id"] not in vectors:
            continue
        index, probs = classify(vectors[item["id"]], matrix, item.get("museum_id"))
        second = int(np.argsort(probs)[-2])
        category = CATEGORIES[index]
        counts[category["key"]] += 1
        results.append({"artwork_id": item["id"], "music_file": music_file(index, category),
                        "category": category["key"], "category_name": category["name"],
                        "confidence": round(float(probs[index]), 3),
                        "second_category": CATEGORIES[second]["key"], "second_confidence": round(float(probs[second]), 3),
                        "_title": item.get("title"), "_artist": item.get("artist"), "_museum": item.get("museum_id")})
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "method": "CLIP ViT-B-32 제로샷 분위기 분류 (Backend/ai/mood_music.py)",
                "total": len(results), "failed": [{"artwork_id": a, "error": e} for a, e in failed],
                "items": [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]}
    (out / "music_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    categories = [{"key": c["key"], "name": c["name"], "description": c["description"], "music_file": music_file(i, c),
                   "count": counts[c["key"]], "track": c["track"]} for i, c in enumerate(CATEGORIES)]
    (out / "categories.json").write_text(json.dumps(categories, ensure_ascii=False, indent=1), encoding="utf-8")
    with (out / "review.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["artwork_id", "title", "artist", "museum", "category", "confidence", "second", "second_confidence"])
        for r in sorted(results, key=lambda r: r["confidence"]):
            writer.writerow([r["artwork_id"], r["_title"], r["_artist"], r["_museum"], r["category_name"], r["confidence"],
                             r["second_category"], r["second_confidence"]])
    return counts, results


def credits_markdown():
    lines = ["# 분위기 음악 출처", "", "모든 음원은 위키미디어 공용(Wikimedia Commons)에서 받았습니다. 작곡은 모두 저작권 보호 기간이 끝난 곡입니다.", "",
             "| 파일 | 분위기 | 곡 | 작곡 | 연주 | 라이선스 | 출처 |", "|---|---|---|---|---|---|---|"]
    for i, c in enumerate(CATEGORIES):
        t = c["track"]
        lines.append(f"| {Path(music_file(i, c)).name} | {c['name']} | {t['title']} | {t['composer']} | {t['performer']} | {t['license']} | {t['page']} |")
    lines += ["", "CC BY 4.0 음원은 앱이나 발표 자료에 다음 표기가 필요합니다:",
              "- " + "; ".join(c["track"]["attribution"] for c in CATEGORIES if "attribution" in c["track"]), ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="작품 분위기 10가지 분류 + 분위기별 무료 음악 폴더 만들기")
    parser.add_argument("--manifest", help="manifest.json URL 또는 파일 경로 (분류할 때 필요)")
    parser.add_argument("--music-only", action="store_true", help="음악 10곡만 내려받고 끝내기")
    parser.add_argument("--out", type=Path, default=BACKEND / "data" / "momi-music", help="분류 결과 폴더")
    parser.add_argument("--images-dir", help="ZIP을 푼 폴더(있으면 image_url 대신 image_path로 읽음)")
    parser.add_argument("--limit", type=int, help="앞에서부터 N점만 (시험용)")
    parser.add_argument("--skip-music", action="store_true", help="음악 내려받기 건너뛰기")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    if not args.skip_music:
        print("1/3 음악 10곡 내려받기 (위키미디어 공용)")
        download_music(MUSIC_ROOT)
    if args.music_only:
        print(f"음악 10곡 준비 완료: {MUSIC_ROOT / 'music'}")
        return
    if not args.manifest:
        parser.error("--manifest가 필요합니다 (음악만 받으려면 --music-only)")
    print("2/3 작품 목록 읽기")
    items = load_manifest(args.manifest)
    if args.limit:
        items = items[:args.limit]
    print(f"  작품 {len(items)}점")

    _use_backend_imports()
    from recognition import ClipEncoder  # 서버와 같은 CLIP·같은 모델 캐시(data/model-cache)를 쓴다.
    encoder = ClipEncoder(BACKEND / "data")
    print("3/3 이미지 분위기 분류 (처음 한 번은 오래 걸리고, 다시 실행하면 이어서 합니다)")
    vectors, failed = encode_all(items, encoder, args.out, args.images_dir)
    counts, results = write_outputs(args.out, items, vectors, category_matrix(encoder), failed)

    print("\n분위기별 작품 수")
    for c in CATEGORIES:
        print(f"  {c['name']:<10} {counts[c['key']]:>5}점")
    low = sum(1 for r in results if r["confidence"] < 0.4)
    print(f"분류 {len(results)}점 · 실패 {len(failed)}점 · 확신 40% 미만 {low}점(review.csv 위쪽부터 확인)")
    print(f"결과 폴더: {args.out}")


if __name__ == "__main__":
    main()
