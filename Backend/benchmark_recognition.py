"""실제 CLIP + 전처리 + 촬영 안내 지연 측정. 인식 정확도/HTTP 부하 테스트와 구분한다."""
import argparse
import json
from pathlib import Path
import platform
import statistics
import time

from dotenv import load_dotenv

if __package__:
    from .catalog import CatalogStore
    from .images import normalize_image
    from .recognition import RecognitionService, image_quality
    from .framing import locate_artwork
else:
    from catalog import CatalogStore
    from images import normalize_image
    from recognition import RecognitionService, image_quality
    from framing import locate_artwork


def main():
    load_dotenv(Path(__file__).with_name('.env'))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--image', type=Path, help='실제 촬영본. 생략 시 첫 등록 원본 사용(정확도 평가 불가)')
    parser.add_argument('--iterations', type=int, default=8)
    args = parser.parse_args()
    if args.iterations < 2:
        parser.error('--iterations는 2 이상이어야 합니다.')
    store = CatalogStore(args.data_dir)
    store.initialize()
    records, total = store.list(1, 0)
    if not records:
        parser.error('먼저 카탈로그를 등록하고 build_index.py를 실행하세요.')
    first = (store.images_dir / records[0]['image_filename']).read_bytes()
    capture = args.image.read_bytes() if args.image else first
    service = RecognitionService(store)
    durations = []
    for _ in range(args.iterations):
        start = time.perf_counter()
        normalized = normalize_image(capture)
        image_quality(normalized.content)
        candidates = service.recognize_artwork(normalized.content)
        if candidates:
            record = store.get(candidates[0]['artwork_id'])
            reference = (store.images_dir / record['image_filename']).read_bytes()
            locate_artwork(normalized.content, reference)
        durations.append(time.perf_counter() - start)
    print(json.dumps({
        'python': platform.python_version(), 'machine': platform.machine(), 'catalog_size': total,
        'input': 'capture' if args.image else 'registered_original',
        'dimensions': [normalized.width, normalized.height], 'iterations': args.iterations,
        'cold_seconds': durations[0], 'warm_seconds': durations[1:],
        'warm_median_seconds': statistics.median(durations[1:]), 'warm_max_seconds': max(durations[1:]),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
