"""카탈로그 이미지의 CLIP 임베딩 생성. 최초 실행 시 모델 가중치를 내려받는다."""
import argparse
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException

if __package__:
    from .catalog import CatalogStore
    from .recognition import RecognitionService
else:
    from catalog import CatalogStore
    from recognition import RecognitionService


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description="작품 CLIP 검색 인덱스 생성")
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    catalog = CatalogStore(args.data_dir)
    catalog.initialize()
    try:
        count = RecognitionService(catalog).build_index()
    except (HTTPException, ValueError, OSError) as exc:
        parser.exit(1, f"인덱스 생성 실패: {getattr(exc, 'detail', str(exc))}\n")
    print(f"작품 {count}점 인덱스 생성 완료")


if __name__ == "__main__":
    main()
