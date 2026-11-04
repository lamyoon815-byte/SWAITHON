"""등록 작품 해설을 생성해 검수용 JSON으로 저장한다. DB의 검수 상태를 자동 변경하지 않는다."""
import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException

if __package__:
    from .catalog import CatalogStore
    from .gemini import GeminiService
else:
    from catalog import CatalogStore
    from gemini import GeminiService


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description="Gemini 해설 사전 생성 → 수동 검수용 JSON 저장 (API 사용량 발생)")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--id", action="append", dest="ids", help="선택한 작품만 생성. 여러 번 지정 가능")
    args = parser.parse_args()
    if args.output.exists():
        parser.exit(1, "출력 파일이 이미 존재합니다. 검수 중인 파일을 덮어쓰지 않도록 다른 경로를 지정해 주세요.\n")
    store = CatalogStore(args.data_dir)
    store.initialize()
    records = store.export_records()
    selected = set(args.ids or [])
    if selected - {record["id"] for record in records}:
        parser.exit(1, "등록되지 않은 작품 ID가 있습니다.\n")
    if selected:
        records = [record for record in records if record["id"] in selected]
    if not records:
        parser.exit(1, "생성할 작품이 없습니다.\n")
    generator = GeminiService()
    try:
        for record in records:
            if record["description"] is None:
                description = generator.describe(Path(record["image_path"]).read_bytes(), record)
                if getattr(description, "fallback", False):
                    raise HTTPException(502, "해설 스키마 검증에 실패했습니다. 기본 안내 문구는 검수 파일에 저장하지 않습니다.")
                record["description"] = description.model_dump(mode="json")
                record["review_status"] = "pending"
                print(f"해설 생성: {record['id']}")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(records, output, ensure_ascii=False, indent=2)
    except (HTTPException, OSError) as exc:
        parser.exit(1, f"해설 생성 실패: {getattr(exc, 'detail', str(exc))}\n")
    print(f"검수 파일 저장: {args.output}\n내용 검수 후 review_status를 reviewed로 바꾸고 import_catalog.py로 등록하세요.")


if __name__ == "__main__":
    main()
