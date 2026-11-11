# MoMi Backend

Python 3.12, FastAPI, SQLite 기반 서버. 아래 명령은 `Backend` 폴더에서 실행한다.

AI 담당자에게 전달할 레포·코드 위치·개발 환경·카탈로그 JSON 예시는
[AI 코드·데이터 연동 안내](ai/README.md)에 정리했다.
합의한 모델·시각 프로필·함수 규격과 회원가입·로그인 범위는
[기술 검토 문서](../docs/tech-review.md)를 기준으로 한다.

## 설치와 실행

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install --python .venv/bin/python -r requirements.txt
./.venv/bin/python -m uvicorn main:app --reload
```

기존 가상환경이 있으면 생성 명령은 생략한다.

- 상태 확인: http://127.0.0.1:8000/health
- API 문서: http://127.0.0.1:8000/docs
- 작품 목록: http://127.0.0.1:8000/artworks

### 지금 이 프로젝트에서 서버 켜기

터미널에서 프로젝트 폴더를 연 뒤 실행한다. 이미 가상환경과 의존성이 설치된 현재 작업 환경에서는 다음 두 줄이면 된다.

```bash
cd Backend
./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

터미널을 열어둔 동안 실행되며 `Ctrl+C`로 종료한다. PC에서는 http://127.0.0.1:8000/docs 를 연다.
같은 Wi-Fi의 휴대폰에서는 `http://맥의_로컬_IP:8000`을 FE API 주소로 설정한다.
다른 네트워크라면 별도 터미널에서 `ngrok http 8000`을 실행하고 발급된 HTTPS 주소를 사용한다.

Gemini를 사용할 때는 `Backend/.env.example`을 `Backend/.env`로 복사해 실제 키·검증한 모델 ID를 넣는다.
기존 `.env`가 있다면 덮어쓰지 않고 필요한 항목만 추가한다. `.env` 변경 후에는 서버를 재시작한다.
키가 없어도 회원·프로필·카탈로그·등록된 검수 해설 API는 사용할 수 있다.

## 회원가입·로그인 및 개인화

`/docs`에서 다음 순서로 확인한다.

1. `POST /auth/register`: 이메일, 8~128자 비밀번호, 닉네임으로 가입한다.
2. 반환된 `access_token`을 화면 상단 **Authorize**에 입력한다.
3. `GET /me/profile`로 초기 프로필을 조회하고 `PUT /me/profile`로 저장한다.
4. 앱은 이 프로필을 받아 Skia로 대비·밝기·선명도·보정 강도와 확대를 적용한다.
5. `POST /me/history`에 `artwork_id`를 보내 감상 당시 설정과 함께 기록한다.

`PUT /me/profile`은 전체 교체다. 생략한 필드는 기본값으로 저장되므로 기존 프로필을 읽어 수정해서 보내야 한다.
`color_vision`은 `normal`, `protanopia`, `deuteranopia`, `tritanopia` 중 하나다.
대비는 0.5~2, 밝기는 -1~1, 보정 강도는 0~1, 선명도는 0~2, 확대는 1~8이다.
색각 보정의 구체적인 행렬·학습 모델은 FE·AI가 구현할 부분이며 서버는 계정 설정을 저장한다.

비밀번호는 Argon2로 해시한다. Bearer 토큰은 무작위 세션 토큰이며 DB에는 토큰 해시만 저장한다.
세션은 7일 후 만료되며 `POST /auth/logout`으로 현재 세션을 즉시 폐기한다.
토큰은 앱의 SecureStore에, 서버에서 받은 프로필 캐시는 AsyncStorage에 보관하는 방식을 권장한다.
실서비스의 인증 요청은 HTTPS로 제공한다. 현재 회원가입은 이메일 소유 확인 메일을 보내지 않는다.
프로필·관람 기록은 로그인한 회원의 것만 조회·수정할 수 있다.

## 카탈로그 등록

저장소에 포함된 `demo/mona-lisa.webp`로 로컬 데모 데이터를 등록한다.
실제 이미지 형식에 맞는 확장자로 원본을 복사하므로 WebP 파일도 등록할 수 있다.

```bash
./.venv/bin/python import_catalog.py catalog.demo.json
```

등록 후 http://127.0.0.1:8000/artworks/mona-lisa 를 열고 `image_url`로 이미지를 확인한다.
데모 파일은 로컬 연동 확인용이며 고해상도 카탈로그 구축 완료를 뜻하지 않는다.
출처·이용 조건을 확인한 고화질 이미지로 교체하고 `source_url`, `license`를 채워야 한다.

여러 작품은 JSON 배열에 추가한다. `image_path`는 JSON 파일의 위치 기준이다.
같은 ID를 다시 등록하면 해당 작품을 갱신한다. 이미지 이름은 파일 내용의 해시로 정해진다.
원본 파일은 그대로 유지하며 DB와 이미지 복사본은 기본적으로 `Backend/data/`에 저장한다.
이 폴더에는 `catalog.sqlite3`(작품), `users.sqlite3`(회원·세션·프로필·관람 기록),
`images/`(등록 작품 원본), `artwork-index.npz`(검색 인덱스), `model-cache/`(CLIP 가중치)가 저장된다.
이 폴더는 Git에서 제외한다. 운영에서는 이 폴더를 영속 저장·백업해야 한다.
저장 위치를 바꾸려면 서버와 가져오기 명령에 같은 `MOMI_DATA_DIR` 환경변수를 설정한다.
이미지 파일 경로는 JSON에서 관리하고 등록은 CLI로만 수행한다.

## API

FE에 전달할 전체 요청·응답·인증·오류 규격은 [FE API 명세서](../docs/api-spec.md)에 있다.
도구에서 가져올 OpenAPI 파일은 [openapi.json](../docs/openapi.json)이다.

| API | 동작 |
|---|---|
| `GET /health` | 서버 상태 확인 |
| `POST /upload` | multipart 필드 `image` 수신, 검증 후 RGB JPEG로 변환, 결과 메타데이터 반환 |
| `GET /artworks?limit=20&offset=0` | 작품 목록과 전체 개수 (`limit`: 1~100) |
| `GET /museums` | 등록 작품이 있는 미술관 목록 |
| `GET /artworks/by-number?number=...&museum_id=...` | 미술관 ID + 번호로 상세 조회. 기존 `museum` 이름 필터도 지원 |
| `GET /artworks/{id}` | 작품 정보·검수된 해설·원본 이미지 URL, 없는 ID는 404 |
| `GET /images/{filename}` | 등록된 원본 이미지 제공 |
| `POST /auth/register` | 이메일 회원가입 및 세션 발급 |
| `POST /auth/login` | 이메일·비밀번호 로그인 |
| `POST /auth/logout` | 현재 세션 로그아웃 (인증 필요) |
| `GET /me` | 내 회원 정보 (인증 필요) |
| `GET /me/profile`, `PUT /me/profile` | 내 시각 프로필 조회·전체 저장 (인증 필요) |
| `GET /me/ai-profile`, `PUT /me/ai-profile` | AI 6필드 프로필 조회·전체 저장. 최초 조회는 `null` (인증 필요) |
| `POST /me/history`, `GET /me/history` | 내 관람 기록 등록·목록 조회 (인증 필요) |
| `DELETE /me/history/{id}` | 내 관람 기록 삭제 (인증 필요) |
| `POST /recognize` | 작품 사진 또는 명패로 후보 상위 3개 검색 (인증 필요) |
| `GET /artworks/{id}/narration` | 감상 모드에 맞춘 검수 해설 텍스트 (인증 필요) |
| `POST /analyze` | 미등록 작품 실시간 분석 (인증 필요, Gemini 설정 필요) |
| `POST /correction` | 원본 작품 ID 또는 촬영본과 AI 프로필로 JPEG 보정. AI 함수 연결 전에는 503 (인증 필요) |

`/upload`는 사용자 사진을 저장하거나 작품 DB에 등록하지 않는다.
작품 번호 조회의 요청·응답 및 FE 오류 처리 규칙은 [FE 전달 내용](../docs/fe-handoff.md)을 참고한다.
JPEG·PNG·WebP·HEIC/HEIF 입력을 JPEG로 변환한다. 한도는 업로드 10MiB, 2,500만 화소다.
카탈로그 원본은 브라우저에서 표시할 수 있는 JPEG·PNG·WebP를 그대로 제공한다.
원본 이미지는 촬영본 전처리와 구분하며 재압축하지 않는다.

## 해설

`description`은 `facts`, `interpretations`, `regions`, `mood_keywords`를 갖는 JSON이다.
`regions.bbox`는 원본 이미지 기준 `[x, y, width, height]`, 범위는 0~1이다.
이 좌표 규칙은 FE·AI와 최종 합의가 필요하다.
`review_status` 기본값은 `pending`이며 이때 API의 해설은 `null`이다.
사람이 검수한 해설을 입력하고 `review_status`를 `reviewed`로 바꿔 재등록하면 해설이 제공된다.

## CLIP 작품 인식

```bash
uv pip install --python .venv/bin/python -r requirements-ai.txt
./.venv/bin/python build_index.py
```

최초 생성 시 CLIP 모델을 내려받는다. 모델은 기본 `ViT-B-32-quickgelu`(OpenAI 가중치의 활성화 함수에 맞춘 ViT-B/32), 가중치는 `openai`, 추론은 CPU다.
`CLIP_MODEL`, `CLIP_PRETRAINED`로 설정을 바꿀 수 있으며 설정 또는 작품 이미지가 바뀌면 인덱스를 재생성한다.
서버는 첫 인식 요청 때 모델을 한 번 로드하고 재사용한다.
이후 `/recognize`에서 `image`와 `mode=artwork`를 보낸다. `mode`를 생략하면 `artwork`다.
인덱스 누락·손상·카탈로그 불일치 시 503으로 안내한다.
코사인 유사도는 확률이 아니다. 현재 반환 정책은 후보 확인이며 검증되지 않은 80% 기준을 적용하지 않는다.
흐림·반사 경고는 규칙 기반 참고값이다. 실제 촬영본으로 정확도·임계값을 평가해야 한다.
데모 1점으로는 작품 간 구별이나 미등록 작품 거부 성능을 평가할 수 없다.

AI 평가 후 `CLIP_MATCH_THRESHOLD`에 -1~1의 임계값을 설정하고 서버를 재시작한다.
사진 모드에서 최고 점수가 기준값보다 낮으면 `status=no_match`, `candidates=[]`를 반환한다.
같거나 높으면 기본 medium이며, 추가로 평가한 `CLIP_HIGH_CONFIDENCE_THRESHOLD` 이상이면 high를 반환한다. 설정을 비워두면 임계값으로 거부하지 않는다.
명패 점수에는 이 임계값을 적용하지 않는다.

## Gemini 명패 인식·해설

`Backend/.env` 또는 실행 환경에 다음 값을 설정한 뒤 서버를 재시작한다.

```dotenv
GEMINI_API_KEY=발급받은_실제_API_키
GEMINI_MODEL=AI_담당자가_검증한_모델_ID
```

모델은 하드코딩하지 않는다. 키와 모델이 없으면 관련 API는 503을 반환한다.
`.env`는 자동 로드하며 Git에는 올리지 않는다. 키는 앱에 포함하지 않는다.
`mode=placard`에서는 Gemini로 제목·작가를 읽고 카탈로그와 퍼지 매칭한다.
미등록 작품은 `/analyze`를 호출한다. 결과는 미검수 상태이며 작가·제목을 추측하지 않도록 요청한다.
해설 JSON 검증 실패 시 1회 재시도하고, 다시 실패하면 기본 문구와 `fallback=true`를 반환한다.
총 외부 호출은 한 요청당 최대 2회이며 HTTP 일시 오류 재시도도 이 횟수 안에 포함한다.
키 미설정·한도 초과·연결 실패·시간 초과는 기존 HTTP 오류로 반환한다.
명패 JSON 검증도 1회 재시도하지만 실패 문구로 작품을 매칭하지 않고 502로 반환한다.
Gemini에는 사진의 축소본이 전송되며, 서버는 사용자 촬영본을 영구 저장하지 않는다.
외부 API는 호출량에 따른 비용이 발생할 수 있다. 동시 호출은 프로세스당 2개, 사용자당 분당 5회로 제한한다.

등록 작품의 사전 해설 생성은 로컬 관리자 스크립트를 사용한다.

```bash
./.venv/bin/python generate_descriptions.py --id mona-lisa --output data/review/catalog.json
```

생성 결과를 직접 검수하고 `review_status`를 `reviewed`로 변경한 뒤 등록한다.
기존 해설이 있는 작품은 재생성하지 않고, 기존 출력 파일을 덮어쓰지 않는다.
기본 안내 문구가 반환된 경우에는 검수용 파일을 생성하지 않고 실패로 종료한다.

```bash
./.venv/bin/python import_catalog.py data/review/catalog.json
```

`/artworks/{id}/narration`은 계정의 `narration_mode` 또는 `mode` 쿼리에 맞는 텍스트를 반환한다.
음성 합성·속도·반복 재생은 앱의 expo-speech가 담당한다.

## 배포

프로젝트 최상위에서 Docker 이미지를 빌드한다. Docker 실행 환경이 필요하다.

```bash
docker build --build-arg WITH_CLIP=true -t momi-be Backend
docker run --rm -p 8000:8000 --env-file Backend/.env -v momi-data:/app/data momi-be
```

새 볼륨에는 작품·검색 인덱스가 없으므로 원본과 JSON을 컨테이너에 마운트하고
`import_catalog.py`, `build_index.py`를 실행하거나 준비된 data 디렉터리를 마운트한다.
외부 공개는 HTTPS 프록시 뒤에서 실행하고, `CORS_ORIGINS`에 실제 웹 클라이언트 주소를 쉼표로 구분해 넣는다.
기본값은 `http://localhost:8081,http://127.0.0.1:8081`이다. 네이티브 앱은 브라우저 CORS 제한을 받지 않는다.
모델 적재 때문에 RAM 1.5GB 이상을 시작점으로 실제 사용량을 측정한다.
현재 인증·AI 호출 제한은 단일 프로세스 기준이므로 워커는 1개로 실행한다.
Gemini 호출 검증은 실제 키·모델이 필요하며 Docker 빌드 검증은 Docker가 설치된 환경에서 수행해야 한다.

## 테스트

`Backend`에서 개발용 의존성을 설치한다.

```bash
uv pip install --python .venv/bin/python -r requirements-dev.txt
```

이후 프로젝트 최상위에서 실행한다. 테스트 데이터는 임시 디렉터리를 사용한다.

```bash
./Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```


## FE 요청 API (README 9.2)

- `GET /museums?limit=20&offset=0`: `{items:[{id,name,area,artwork_count}],total,limit,offset}`. 등록 작품이 있는 미술관만 반환하며 지역 미수집 시 area는 빈 문자열.
- 작품의 `museum_id`로 `GET /artworks?museum_id=...`, `GET /artworks/by-number?museum_id=...&number=007` 조회. `number`는 앞자리 0을 보존하는 문자열. 기존 `museum` 이름 필터도 지원.
- 카탈로그에는 `museum_id`와 `museum`을 함께 등록. 기존 이름만 있는 데이터는 시작 시 결정적인 ID로 자동 보완. 같은 ID는 같은 이름, 번호는 ID 내 고유. 이름 변경 시 기존 ID를 명시하여 유지.
- QR 페이로드는 `momi://artwork/<id>`로 확정. FE에서 ID 검증 후 작품 상세 조회.
- `/recognize`의 `confidence`: high는 바로 이동, medium은 확인, low는 후보 없음. 실제 촬영본으로 평가한 `CLIP_MATCH_THRESHOLD`, `CLIP_HIGH_CONFIDENCE_THRESHOLD`가 없으면 후보는 medium. 후보가 없으면 low.
- 사진 자동 촬영은 사용자당 60회/60초. 처리 중 추가 요청은 503 + Retry-After: 2로 거부하여 CPU 대기열을 만들지 않음. FE는 진행 중 요청을 겹치지 않고 1~2초 간격으로 예약. 명패 자동 반복은 지원하지 않음(기존 Gemini 공유 5회/분).
- `quality.artwork_bbox`는 회전 보정된 촬영본 대비 정규화 xywh. 최고 후보 원본과 ORB/RANSAC 위치 검증에 성공할 때 `framing_hint`도 제공. 실패·명패·후보 없음은 둘 다 null.
- Description의 `fact_region_indices`, `interpretation_region_indices`는 해당 문장 배열과 같은 길이의 0 기반 regions 인덱스/null 배열. 생략하면 null. Gemini 생성 및 import 시 길이·범위 검증 후 narration의 각 `region_index`로 전달. 기존 검수 해설의 누락 연결은 추측하지 않고 null.

실측 범위·배포 검증은 [부하 기록](../docs/recognition-load.md), FE 전체 계약은 [API 명세](../docs/api-spec.md) 참고.

## OpenAI 음성 해설

Gemini는 해설 텍스트를 만들고, OpenAI는 그 문장을 음성으로 읽습니다. `Backend/.env`에 별도 OpenAI 키를 설정한 뒤 서버를 재시작합니다. 키는 앱·Git에 넣지 않습니다.

```dotenv
OPENAI_API_KEY=개인_API_키
OPENAI_TTS_MODEL=gpt-realtime-2.1-mini
OPENAI_TTS_VOICE=cedar
```

2026-11-11 [공식 안내](https://developers.openai.com/api/docs/guides/text-to-speech)에 따라 신규 연동은 Realtime API를 사용합니다. 구형 Speech API 모델은 2027-01-06 종료 예정입니다. 목소리는 `.env`의 `OPENAI_TTS_VOICE`를 `cedar`로 바꿔 비교할 수 있습니다. 실제 한국어 음색과 지연은 해당 키로 청취·측정해야 합니다.

- `POST /speech`: JSON `text`(1~600자), 성공은 `audio/wav`(24kHz mono PCM16 WAV). 앱이 문장별로 재생하며 출력 transcript가 원문과 다르면 재생용 음성을 반환하지 않습니다. 공백·구두점 차이만 무시합니다.
- 입력 텍스트·API 키는 로그에 기록하지 않습니다. 성공한 음성 WAV는 `data/generated-media.sqlite3`에 영구 저장합니다. 동일 모델·목소리·지침·문장은 서버 재시작 후에도 DB에서 재사용하며, 최근 음성은 메모리에도 최대 32개/24MiB 캐시합니다. 앱은 캐시 파일로 재사용하고 속도는 기기에서 조절합니다.
- `/speech`는 별도 IP당 분당 60회 제한, 동시 생성 2개, 45초 타임아웃을 적용합니다. Gemini 호출 제한과 독립적입니다. OpenAI 키 미설정은 503이며 앱은 기기 음성으로 대신 읽지 않습니다.
- **OpenAI 비용은 Gemini 예산과 별도입니다.** `OPENAI_TTS_BUDGET_KRW`(기본 12,000원), `OPENAI_TTS_DAILY_LIMIT`(기본 300회)로 제한합니다. 사용액은 `data/openai-tts-usage.json`에 기록하며 단가·환율 추정치입니다. 출력 토큰 전체를 오디오 단가로 보수적으로 계산합니다. 캐시 적중은 외부 호출·생성 비용이 없습니다.
- 재생 도중 화면을 벗어나면 멈추며, 늦게 도착한 음성이 자동 재생되지 않습니다. 이미 시작한 서버 생성은 최대 45초 안에 완료될 수 있으며 사용액은 정산합니다.

### 생성 해설·음성 영구 캐시

등록 작품의 `POST /artworks/{id}/narration` 성공 결과는 `data/generated-media.sqlite3`에 JSON으로 저장합니다. 작품 원본·메타데이터·Gemini 모델이 같은 다음 요청은 저장된 해설을 반환하며 생성 호출 제한·예산을 소모하지 않습니다. 동시 요청도 서버 프로세스 안에서 한 번의 생성을 공유합니다. 프롬프트·응답 규격을 수정하면 `ai_routes.py`의 `narration-v1` 버전을 올립니다. 미검수 상태는 유지되며, 실패·fallback·빈 해설은 저장하지 않습니다. 미등록 촬영본 `/analyze`는 기존처럼 저장하지 않습니다.

앱이 문장별로 `/speech`를 요청하면 첫 재생 때 만든 WAV를 같은 DB에 저장하고 이후 그대로 반환합니다. 목소리·모델·문장이 달라지면 별도 음성이 생성됩니다. 서버 재시작·앱 재설치 후에도 재사용하려면 배포 시 `data/`를 영속 볼륨으로 유지하고 백업에 포함합니다.
