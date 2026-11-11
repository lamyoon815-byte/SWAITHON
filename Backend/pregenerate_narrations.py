"""등록 작품의 간결(약 1분)·상세(약 3분) 해설을 미리 만들어 서버 저장소에 넣는다.

앱에서 누를 때와 같은 키·같은 형식으로 저장하므로, 미리 만든 해설은 기다리지 않고 바로 나온다.
이미 저장된 해설은 건너뛴다(다시 실행하면 이어서 한다).

사용법 (Backend 폴더):
    ./.venv/bin/python pregenerate_narrations.py --length brief
    ./.venv/bin/python pregenerate_narrations.py --length detailed --museum nmk --museum kansong
    ./.venv/bin/python pregenerate_narrations.py --length both --ids met-01 aic-01

상세 해설은 Gemini 구글 검색 근거를 쓰므로 작품마다 검색 비용이 생길 수 있다.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import time

from dotenv import load_dotenv
from fastapi import HTTPException

if __package__:
    from .ai_routes import AI_WARNING, LONG_COMMENTARY_DIR, make_narration, narration_key
    from .catalog import CatalogStore
    from .gemini import GeminiService
    from .generated_cache import GeneratedCache
else:
    from ai_routes import AI_WARNING, LONG_COMMENTARY_DIR, make_narration, narration_key
    from catalog import CatalogStore
    from gemini import GeminiService
    from generated_cache import GeneratedCache


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description="간결·상세 해설 일괄 생성")
    parser.add_argument("--length", choices=["brief", "detailed", "both"], default="brief")
    parser.add_argument("--museum", action="append", help="이 미술관 ID만 (여러 번 지정 가능)")
    parser.add_argument("--ids", nargs="*", help="이 작품 ID만")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()

    store = CatalogStore(args.data_dir)
    store.initialize()
    cache = GeneratedCache(store.data_dir)
    gemini = GeminiService()
    gemini.slots = __import__("threading").BoundedSemaphore(args.workers)  # 스크립트는 서버와 따로 동시 실행 수를 정한다.
    lengths = ["brief", "detailed"] if args.length == "both" else [args.length]

    records = [r for r in store.export_records()
               if (not args.museum or r.get("museum_id") in args.museum) and (not args.ids or r["id"] in args.ids)]
    jobs = []
    for record in records:
        image_path = Path(record.pop("image_path"))
        stored = store.get(record["id"])  # API와 같은 레코드 모양(image_filename 포함)으로 키를 만든다.
        content = image_path.read_bytes()
        for length in lengths:
            if length == "detailed" and (LONG_COMMENTARY_DIR / f"{record['id']}.json").is_file():
                continue  # 사람이 검수한 상세 해설이 있으면 그걸 쓴다.
            key = narration_key(length, gemini.model, stored, content)
            if cache.get("narration", key) is None:
                jobs.append((record["id"], stored, content, length, key))
    print(f"작품 {len(records)}점, 만들 해설 {len(jobs)}개 ({', '.join(lengths)})", flush=True)

    def run(job):
        artwork_id, record, content, length, key = job
        for attempt in range(3):
            try:
                result = make_narration(gemini, artwork_id, record, content, length)
                if result["fallback"] or not result["segments"]:
                    if attempt < 2:
                        continue  # 형식이 어긋난 응답은 다시 만들면 대부분 된다.
                    return artwork_id, length, "실패(빈 해설)"
                cache.put("narration", key, json.dumps({**result, "warning": AI_WARNING}, ensure_ascii=False).encode())
                return artwork_id, length, f"{result['estimated_seconds']}초"
            except HTTPException as exc:
                if exc.status_code in (429, 503, 504) and attempt < 2:
                    time.sleep(10 * (attempt + 1))
                    continue
                return artwork_id, length, f"실패({exc.status_code} {exc.detail})"
        return artwork_id, length, "실패"

    done = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in as_completed([pool.submit(run, job) for job in jobs]):
            artwork_id, length, outcome = future.result()
            done += 1
            failed += outcome.startswith("실패")
            if outcome.startswith("실패") or done % 25 == 0:
                print(f"  {done}/{len(jobs)} {artwork_id} {length}: {outcome}", flush=True)
    print(f"완료: {done - failed}개 저장, 실패 {failed}개", flush=True)


if __name__ == "__main__":
    main()
