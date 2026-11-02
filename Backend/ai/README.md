# AI 코드·데이터 연동 안내

## 시작 정보

- 레포: https://github.com/lamyoon815-byte/SWAITHON
- 통합 브랜치: `develop`
- AI 함수·평가 코드 위치: `Backend/ai/`
- Python: **3.12**, 현재 개발 환경 **3.12.16**
- 최신 결정·미합의 사항: [기술 검토 문서](../../docs/tech-review.md)
- BE 실행·키 설정·데이터 등록: [BE README](../README.md)

이 폴더에는 아직 AI 함수가 구현되지 않았습니다. `correction.py`, `description.py`, `evaluation.py` 등으로 나눠 구현할 수 있습니다.
프로필·함수 규격은 AI 제안이며 현재 회원 API의 구규격과 다릅니다.
코드 import만으로 모델 다운로드·외부 API 호출·데이터 생성이 실행되지 않도록 작성합니다.

## 설치와 테스트

프로젝트 최상위에서 실행합니다. 기존 `.venv`가 있으면 생성 명령을 생략합니다.

```bash
cd Backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-ai.txt -r requirements-dev.txt
cd ..
./Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```

AI 테스트도 `Backend/tests/test_ai_*.py`에 두면 같은 명령으로 실행됩니다.
현재 Gemini 통합 자동 테스트는 모의 응답을 사용합니다. 실제 키·모델 검증을 대신하지 않습니다.
CLIP 모델은 `build_index.py`를 실행하거나 최초 추론할 때 불러옵니다.

## 함수 연동

제안한 인터페이스:

```text
correct_image(image, profile) -> corrected_jpeg
describe_artwork(image, mode, artwork_info=None) -> description_json
```

- 보정 입력 프로필: `color_type`, `severity`, `contrast`, `brightness`, `sharpness`, `edge`.
- 입력 이미지와 같은 크기의 JPEG를 반환한다는 규격입니다. Python 이미지 타입·JPEG 반환 타입은 확정이 필요합니다. BE는 RGB JPEG `bytes`를 준비합니다.
- 보정 함수를 서버 서비스에 사용할지, 기존 FE Skia 구현의 비교·검증용으로 사용할지는 확인 필요입니다.
- 해설 공용 모델: `Backend/catalog.py`의 `Description`, `Region`.
- 해설 모드: 현재 BE의 `facts`, `interpretations`, `both`와 AI 함수의 모드를 맞춰야 합니다.
- `artwork_info=None`은 미등록 작품이며 작가·제목을 추측하지 않습니다.
- 기존 외부 호출·실패 처리는 `Backend/gemini.py`에 있으므로 별도 클라이언트를 중복 구현하기 전에 BE와 연결 지점을 맞춥니다.
- Gemini 기본 제안은 `gemini-3.1-flash-lite`. 대안 `gemini-3.5-flash`는 공식 문서상 3.6으로 연결되므로 실제 대안 ID를 재확인합니다.

## 작품 카탈로그 등록 형식

UTF-8 JSON **배열**로 저장합니다. 아래는 이 폴더에 `catalog.json`을 만드는 경우의 로컬 데모 예시입니다.

```json
[
  {
    "id": "mona-lisa",
    "title": "모나리자",
    "artist": "레오나르도 다 빈치",
    "year": null,
    "background": null,
    "source_url": null,
    "license": null,
    "image_path": "../demo/mona-lisa.webp",
    "description": null,
    "review_status": "pending"
  }
]
```

- 필수: `id`, `title`, `artist`, `image_path`.
- `id`: 영문 소문자·숫자로 시작하고 영문 소문자·숫자·`_`·`-`만 허용, 최대 80자.
- `image_path`: **JSON 파일이 위치한 폴더 기준** 상대 경로 또는 절대 경로.
- 원본 이미지: JPEG·PNG·WebP. 카탈로그 원본은 재압축하지 않고 복사·서빙합니다.
- `year`: 연도 또는 시기 설명 문자열. 선택 필드는 생략 가능하며 예시의 `null`도 허용됩니다.
- 실제 수집 작품은 `source_url`, `license`에 개별 이미지 출처·퍼블릭 도메인 근거를 기재합니다. 위의 빈 값은 로컬 데모용입니다.
- `description`: 생성 전에는 `null`. 생성 후 `facts`, `interpretations`, `regions`, `mood_keywords`를 가진 JSON입니다.
- `review_status`: 기본 `pending`. 사람이 검수한 해설이 있을 때만 `reviewed`로 등록합니다.
- 현재 로컬 BE 작업본에는 선택 필드 `number`(작품 번호 문자열), `museum`(미술관)이 추가 중입니다. 이 문서 작성 시 원격 develop 미반영 상태이므로 수집·등록에 사용하기 전 반영 여부를 확인합니다.

프로젝트 최상위에서 등록:

```bash
./Backend/.venv/bin/python Backend/import_catalog.py Backend/ai/catalog.json
```

저장소에 이미 있는 데모 사용:

```bash
./Backend/.venv/bin/python Backend/import_catalog.py Backend/catalog.demo.json
```

등록 후 인덱스 생성:

```bash
./Backend/.venv/bin/python Backend/build_index.py
```

카탈로그 이미지·모델이 바뀌면 인덱스를 재생성합니다. 같은 작품 ID를 재등록하면 해당 데이터를 갱신합니다.
실제 데이터·가중치·촬영본은 Git에서 제외되는 `Backend/data/`에 두고 공유 방법을 따로 맞춥니다.

## CLIP 평가 결과 전달

작품 20점의 실제 촬영본 60장과 미등록 작품 사진 10장으로 평가할 예정입니다.
BE 기본 설정은 `CLIP_MODEL=ViT-B-32-quickgelu`, `CLIP_PRETRAINED=openai`입니다.
결과와 함께 모델·가중치·전처리·카탈로그 버전, Top-1·Top-3, 미등록 오매칭·등록 오거부, 점수 분포, 임계값·비교 규칙을 공유합니다.
임계값 전달 전에는 기존 BE가 후보 확인 응답을 반환하며, 자동 미등록 판정이 구현된 상태가 아닙니다.
