"""사용법: python import_catalog.py catalog.demo.json"""

import argparse
from pathlib import Path

from PIL import UnidentifiedImageError
from pydantic import ValidationError

if __package__:
    from .catalog import CatalogStore
else:
    from catalog import CatalogStore


def main():
    parser = argparse.ArgumentParser(description="JSON 카탈로그를 SQLite와 이미지 폴더에 등록합니다.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--data-dir", type=Path, default=None)
    args = parser.parse_args()
    try:
        count = CatalogStore(args.data_dir).import_manifest(args.manifest)
    except (OSError, ValueError, ValidationError, UnidentifiedImageError) as exc:
        parser.exit(1, f"카탈로그 등록 실패: {exc}\n")
    print(f"작품 {count}점 등록 완료")


if __name__ == "__main__":
    main()
