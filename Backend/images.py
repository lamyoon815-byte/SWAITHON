"""사용자 촬영본 검증과 메모리 내 JPEG 전처리."""
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from starlette.concurrency import run_in_threadpool

register_heif_opener(thumbnails=False)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF"}


@dataclass(frozen=True)
class NormalizedImage:
    content: bytes
    source_format: str
    width: int
    height: int


def normalize_image(contents: bytes) -> NormalizedImage:
    """확장자와 MIME 대신 실제 데이터를 검사하고 RGB JPEG 바이트를 만든다."""
    try:
        with Image.open(BytesIO(contents)) as source:
            image_format = source.format
            if image_format not in ALLOWED_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=415,
                    detail="JPEG, PNG, WebP 또는 HEIC/HEIF 이미지를 보내주세요.",
                )
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413, detail="이미지는 2,500만 화소 이하여야 합니다."
                )
            source.verify()

        # verify() 후에는 이미지를 다시 열어 실제 픽셀까지 디코딩한다.
        with Image.open(BytesIO(contents)) as source:
            source.load()
            with ImageOps.exif_transpose(source) as oriented:
                # 투명한 픽셀은 흰 배경에 합성해 JPEG의 검은 배경을 피한다.
                with oriented.convert("RGBA") as rgba:
                    with Image.new("RGB", rgba.size, "white") as normalized:
                        with rgba.getchannel("A") as alpha:
                            normalized.paste(rgba, mask=alpha)
                        output = BytesIO()
                        # 새 이미지로 인코딩해 EXIF/GPS 등 원본 메타데이터는 넘기지 않는다.
                        normalized.save(output, format="JPEG", quality=90)
                        return NormalizedImage(
                            content=output.getvalue(),
                            source_format=image_format,
                            width=normalized.width,
                            height=normalized.height,
                        )
    except Image.DecompressionBombError as exc:
        raise HTTPException(
            status_code=413, detail="이미지 해상도가 너무 큽니다."
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="이미지를 읽을 수 없습니다. 정상적인 사진을 보내주세요."
        ) from exc


async def upload_image(
    image: Annotated[
        UploadFile,
        File(description="업로드할 사진. JPEG·PNG·WebP·HEIC/HEIF 지원, 최대 10MiB·2,500만 화소."),
    ],
):
    """이미지 검증·전처리 확인용. 이미지는 영구 저장하지 않는다."""
    try:
        if image.size is not None and image.size > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="이미지는 10MB 이하여야 합니다.",
            )

        contents = await image.read(MAX_UPLOAD_BYTES + 1)

        if not contents:
            raise HTTPException(status_code=400, detail="빈 파일입니다.")

        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="이미지는 10MB 이하여야 합니다.",
            )

        # 이미지 디코딩은 스레드에서 처리해 다른 요청을 막지 않는다.
        normalized = await run_in_threadpool(normalize_image, contents)

        return {
            "filename": image.filename,
            "size_bytes": len(contents),
            "source_format": normalized.source_format,
            "normalized_filename": f"{Path(image.filename or 'image').stem}.jpg",
            "format": "JPEG",
            "content_type": "image/jpeg",
            "normalized_size_bytes": len(normalized.content),
            "width": normalized.width,
            "height": normalized.height,
            "mode": "RGB",
        }
    finally:
        await image.close()
