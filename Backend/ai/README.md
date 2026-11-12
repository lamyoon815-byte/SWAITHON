# AI 코드·데이터 연동 안내

## 시작 정보

- 레포: https://github.com/lamyoon815-byte/SWAITHON
- 통합 브랜치: `develop`
- AI 함수·평가 코드 위치: `Backend/ai/`
- Python: **3.12**, 현재 개발 환경 **3.12.16**
- 최신 결정·미합의 사항: [기술 검토 문서](../../docs/tech-review.md)
- BE 실행·키 설정·데이터 등록: [BE README](../README.md)

이 폴더의 `profile.py`에는 AI 입력 스키마가 있습니다. 보정·해설·평가 함수는 아직 구현되지 않았으며 `correction.py`, `description.py`, `evaluation.py` 등으로 나눠 구현할 수 있습니다.
AI 6필드 프로필은 `GET/PUT /me/ai-profile`로 별도 저장합니다. 기존 `/me/profile`의 앱 규격과 독립적이며 밝기를 자동 변환하지 않습니다.
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
- 보정 계약은 동기 `correct_image(image: bytes, profile: dict) -> bytes`입니다. RGB JPEG 바이트와 6필드 dict를 받아 같은 크기의 JPEG 바이트를 반환합니다. `Backend/ai/correction.py`에 구현하면 `/correction`이 호출합니다. 함수가 없으면 503을 반환합니다.
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
    "number": "INV 779",
    "museum": "루브르 박물관",
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
- 현재 로컬 BE 작업본은 선택 필드 `number`(작품 번호 문자열), `museum`(미술관)을 지원합니다. 앞자리 0이나 문자를 보존하도록 번호는 문자열로 전달합니다. 같은 미술관에서 같은 번호를 여러 작품에 중복 등록할 수 없습니다. `museum` 없이 등록한 번호도 서로 중복할 수 없습니다.
- `number`, `museum`과 번호 조회 API는 `develop`의 `ee75118`에 반영됐습니다. 새 AI 프로필·보정 API는 이 문서와 함께 커밋한 코드에 포함됩니다. 배포 반영은 별도 확인합니다.

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
임계값 전달 전에는 BE가 후보 확인 응답을 반환합니다. 평가값을 `CLIP_MATCH_THRESHOLD`에 설정하면 최고 점수가 기준 미만일 때 `no_match`와 빈 후보를 반환합니다. 같으면 후보 확인을 유지합니다.


## FE 9.2 추가 AI 계약

- 카탈로그 작품은 `museum_id`(안정적인 영문 소문자·숫자·하이픈·밑줄 ID), `museum`(표시명), `number`(미술관 내 고유 문자열)를 함께 등록합니다. 미술관 ID 미지정 시 이름에서 생성하므로 새 데이터는 명시적 ID를 권장합니다.
- 실제 촬영본 평가 전 confidence는 후보가 있으면 medium, 없으면 low. 평가한 거부 기준을 `CLIP_MATCH_THRESHOLD`, 바로 이동할 기준을 `CLIP_HIGH_CONFIDENCE_THRESHOLD`에 설정하며 high >= match여야 합니다. 두 기준이 없으면 high는 반환하지 않습니다. 명패는 medium/low만 반환합니다.
- 촬영본 위치는 BE가 최고 후보 원본과 ORB/RANSAC으로 검증합니다. `quality.artwork_bbox`는 회전 보정 촬영본의 xywh 비율, 검증 실패는 null. CLIP 유사도에서 bbox를 추측하지 않습니다.
- Gemini `Description`에는 `fact_region_indices`, `interpretation_region_indices`를 추가했습니다. 각각 facts/interpretations와 같은 길이이며 각 값은 regions의 0 기반 인덱스 또는 null입니다. 전체 설명·불확실한 연결은 null로 둡니다. 잘못된 길이/범위는 스키마 오류로 재시도/기존 fallback 흐름을 따릅니다.
- 검수 시 문장과 영역 연결도 함께 확인합니다. 기존 해설은 배열 누락을 허용하며 narration의 region_index는 null입니다. 연결을 보완하려면 관리자 검수 JSON에 배열을 추가하고 재등록합니다.

## AI 파트 구현 (feature/ai-finetune)

### API 분리와 응답 (FE 연동)

| API | 하는 일 |
|---|---|
| `POST /recognize/artwork` | 작품 사진으로 등록 작품 찾기 (CLIP + 파인튜닝 어댑터 + 작품/작품 아님 판별) |
| `POST /recognize/placard` | 명패 사진으로 등록 작품 찾기 (Gemini 글자 읽기) |
| `POST /analyze` | 미등록 작품 AI 해설 (Gemini, 예산 상한 적용) |
| `POST /recognize` | 이전 버전 호환용(deprecated). 새 코드는 위 두 API 사용 |

인식 응답에 기존 필드는 그대로 두고 아래를 추가했습니다. 앱은 `next_action`으로 화면을 나누고 `message`를 그대로 보여주거나 읽어 주면 됩니다.

| next_action | 상황 | 앱 동작 |
|---|---|---|
| `show_artwork` | 등록 작품으로 확신 | 바로 작품 화면 |
| `confirm_candidates` | 비슷한 등록 작품 후보 | 후보 확인 |
| `analyze` | 작품 사진이지만 미등록 (`reason=unregistered_artwork`) | 같은 사진으로 `/analyze` 호출 |
| `retake` | 손·바닥 등 작품이 아닌 사진(`not_artwork`) 또는 명패를 못 읽음 | "작품을 인식하지 못했어요…" 안내 후 다시 촬영 |

`artwork_probability`는 작품을 찍은 사진일 확률(CLIP 제로샷, 0~1)입니다.

### 파인튜닝 (CLIP-Adapter) 실행 순서

CLIP 본체는 고정하고 임베딩 뒤의 작은 잔차 어댑터만 대조 학습합니다. 학습 데이터는 NGA 공개 그림 400점을
휴대폰 촬영처럼 변형한 사진이며, 등록 작품 21점과 평가용 미등록 10점은 학습에서 제외했습니다.

```powershell
.\Backend\.venv\Scripts\python.exe Backend\ai\finetune\prepare_eval.py       # 평가 폴더 + 미등록 원본 10점
.\Backend\.venv\Scripts\python.exe Backend\ai\finetune\download_training.py  # 학습 그림 400점
.\Backend\.venv\Scripts\python.exe Backend\ai\finetune\extract_features.py   # 원본+변형 16장 CLIP 임베딩
.\Backend\.venv\Scripts\python.exe Backend\ai\finetune\train_adapter.py      # 어댑터 학습 → data/clip-adapter.npz
.\Backend\.venv\Scripts\python.exe Backend\ai\evaluation.py                  # 실제 촬영본으로 전/후 비교 + 기준값
.\Backend\.venv\Scripts\python.exe Backend\build_index.py                    # 어댑터 반영 인덱스 재생성
```

`evaluation.py`는 작품 단위 5겹 교차 검증으로 기준값을 정하고(기준을 정한 사진과 확인한 사진을 분리),
`Backend/data/eval/report.md`와 `.env`에 넣을 값(`CLIP_ADAPTER`, `CLIP_MATCH_THRESHOLD`,
`CLIP_HIGH_CONFIDENCE_THRESHOLD`, `ARTWORK_GATE_THRESHOLD`)을 출력합니다. 파인튜닝 후 성능이 좋아지지 않으면 `CLIP_ADAPTER=off`를 추천합니다.

### 속도와 비용

- `CLIP_WARMUP=1`: 서버 시작 때 모델·인덱스를 미리 불러 첫 요청도 빠르게 처리합니다.
- 작품 판별은 인식에 쓴 CLIP 임베딩을 재사용해 추가 모델 호출이 없습니다. 어댑터는 numpy 행렬 곱 2번입니다.
- Gemini: 호출 전 `사용액 + 1회 최대 비용 > GEMINI_BUDGET_KRW(기본 12,000원)`이면 429로 막고, 응답의 실제 토큰 수로 사용액을 `data/gemini-usage.json`에 기록합니다. 금액은 단가·환율 설정으로 계산한 추정치입니다.

### 이미지 보정 (`POST /correction`, `ai/correction.py`)

`correct_image(content, profile)`가 같은 크기의 JPEG를 반환합니다. 처리 순서는 아래와 같습니다.

1. 색각 보정(`color_type`, `severity`): Machado(2009) 색각이상 시뮬레이션 행렬로 사용자가 잃는 색 차이를 계산하고, 그 차이를 사용자가 구분할 수 있는 색 방향으로 옮깁니다(Daltonization). `severity`는 0~1 사이 표 값을 보간합니다.
2. 밝기·대비(`brightness`, `contrast`): 대비는 시그모이드 곡선(ImageMagick `sigmoidal-contrast`와 같은 식)을 밝기(luma)에만 적용하고, 곡선 중심은 그림의 평균 밝기가 바뀌지 않는 점으로 정합니다. 검정·흰색이 잘리지 않아 어두운 그림이 검게 뭉개지지 않습니다. 앱 Skia(`Frontend/src/lib/tone-curve.ts`)와 같은 식입니다. 밝기는 CIELAB L*에 더합니다.
3. 선명도(`sharpness`): 언샤프 마스크.
4. 선 굵기·윤곽(`edge`): 가는 어두운 선(Black-hat 형태학 연산)을 찾아 두껍게 하되 바탕이 어두우면 약하게 하고, Canny로 찾은 경계 근처에 양극성 윤곽(Peli et al., 2004: 경계의 밝은 쪽은 밝게, 어두운 쪽은 어둡게)을 더합니다. 평균 밝기가 유지되고, 어두운 곳은 원래 밝기의 절반보다 어두워지지 않습니다.

검증용 비교 이미지와 수치: `Backend\.venv\Scripts\python.exe Backend\ai\correction_demo.py` → `Backend/data/eval/correction/`
(등록 작품 21점, 색각이상 시뮬레이션에서 구분이 사라진 색 쌍 중 보정 후 다시 구분되는 비율: 적색약 66%, 녹색약 64%, 청색약 84%)

### 음성 인식 (`POST /transcribe`, `ai/transcription.py`)

OpenAI 받아쓰기(`OPENAI_STT_*`, Gemini와 별도 예산)로 짧은 음성을 글자로 바꿉니다. `purpose`로 쓰임을 나눕니다.

| purpose | 쓰는 곳 | 받아쓰기 힌트 | 글자 → 결과 |
|---|---|---|---|
| `answer`(기본) | 화면 맞추기 숫자 답 | 검사판 숫자 예시 | 앱 `spoken-answer.ts`가 보기와 맞춤 → `/calibration/voice-answers`에 저장 |
| `artwork` | 작품 찾기 화면 🎤 | 등록 작품의 한국어 제목·작가 (최대 400자) | 앱 `voice-search.ts`가 지금 미술관 작품에서 찾음 |

작품 음성 검색은 "5번"처럼 번호만 말하면 번호로 찾고, "수련"·"모네 수련 찾아줘"·"거대한 파도"(괄호 속 별칭)·"고흐"(작가)처럼 말하면 제목·작가로 찾습니다. 받아쓰기가 조금 틀려도("물뿌리게") 글자 겹침 정도로 찾고, 하나면 바로 열고 여러 개면 목록으로 보여 줍니다. 규칙 확인: `node Frontend/scripts/tests/voice-search.test.cjs`
