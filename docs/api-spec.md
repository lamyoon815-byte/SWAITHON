# MoMi FE API 명세서

기준일: 2026-11-04. **이 문서와 함께 커밋한 백엔드 코드 기준**입니다. 배포 서버의 반영 상태는 별도로 확인합니다.
미술관·번호·QR, confidence, 자동 촬영 호출 제한, 위치 힌트·해설 영역 연결과 기존 AI 계약을 포함합니다.
`POST /correction`은 라우트와 입력·출력 계약만 준비됐으며 실제 AI 함수 미연결로 정상 입력에도 503을 반환합니다.

## 1. 접속 및 공통 규칙

| 항목 | 규칙 |
|---|---|
| 로컬 Base URL | `http://127.0.0.1:8000` |
| 휴대폰 Base URL | 같은 Wi-Fi의 `http://서버PC_IP:8000` 또는 공유받은 ngrok HTTPS 주소 |
| API 경로 | Base URL 바로 뒤에 연결. `/api` 접두사 없음 |
| Swagger | `{BASE_URL}/docs` |
| 라이브 OpenAPI | `{BASE_URL}/openapi.json` |
| 공유용 OpenAPI | [openapi.json](openapi.json). 코드에서 생성한 스냅샷이며 일부 런타임 오류·정적 이미지 경로는 아래 본문 참고 |
| JSON 요청 | `Content-Type: application/json` |
| 파일 요청 | `multipart/form-data`. FE에서 Content-Type을 직접 지정하지 않고 FormData에 맡김 |
| 인증 | 앱은 사용하지 않음. 회원 API(`/me/*`)만 `Authorization: Bearer {access_token}` |
| 시간 | ISO 8601 UTC 문자열. 화면 표시는 FE에서 현지 시간으로 변환 |
| 빈 값 | 응답의 `null`과 빈 배열을 정상 상태로 처리 |
| 페이지네이션 | `limit` 기본 20, 1~100 / `offset` 기본 0, 0 이상 |

가입·로그인 시 받은 토큰은 7일간 유효합니다. JWT가 아닌 세션 토큰이므로 토큰 내부를 해석하지 않습니다.
갱신 토큰 API는 없으며 만료 시 다시 로그인합니다. 401이면 로그인 화면으로 연결합니다.
로그아웃은 현재 토큰만 폐기합니다. 토큰 저장은 앱 SecureStore를 사용합니다.

이미지 입력은 JPEG·PNG·WebP·HEIC/HEIF, 파일당 **10MiB(10,485,760바이트)**·**2,500만 화소** 이하입니다.
서버는 회전 보정·RGB JPEG 전처리를 수행합니다. 사용자 촬영본·보정본은 영구 저장하지 않습니다.
`/upload`는 사전 필수 단계가 아닙니다. `/recognize`, `/analyze`, `/correction`에 파일을 직접 보냅니다.

## 2. API 목록

> **앱은 로그인 없이 기기 로컬 저장만 사용합니다** (2026-11-06 결정). 작품·인식·해설·보정 API는 토큰 없이 호출하고,
> 호출 제한은 접속 IP 기준입니다. `/auth/*`, `/me/*` 회원·프로필·관람 기록 API는 서버에 남아 있지만 앱에서 사용하지 않습니다.

| Method | Path | 인증 | 성공 | 용도 |
|---|---|---|---|---|
| GET | `/health` | 불필요 | 200 | 서버 연결 확인 |
| POST | `/auth/register` | 불필요 | 201 | 회원가입 및 토큰 발급 (앱 미사용) |
| POST | `/auth/login` | 불필요 | 200 | 로그인 (앱 미사용) |
| POST | `/auth/logout` | 필요 | 204 | 현재 세션 로그아웃 (앱 미사용) |
| GET | `/me` | 필요 | 200 | 내 회원 정보 (앱 미사용) |
| GET | `/me/profile` | 필요 | 200 | 앱 시각·음성 설정 조회 (앱 미사용) |
| PUT | `/me/profile` | 필요 | 200 | 앱 설정 전체 저장 (앱 미사용) |
| GET | `/me/ai-profile` | 필요 | 200 | AI 6필드 프로필 조회 (앱 미사용) |
| PUT | `/me/ai-profile` | 필요 | 200 | AI 프로필 전체 저장 (앱 미사용) |
| GET | `/museums` | 불필요 | 200 | 등록 작품이 있는 미술관 목록 |
| GET | `/artworks` | 불필요 | 200 | 등록 작품 목록 |
| GET | `/artworks/by-number` | 불필요 | 200 | 작품 번호·미술관 조회 |
| GET | `/artworks/{artwork_id}` | 불필요 | 200 | 작품 상세 |
| GET | `/images/{filename}` | 불필요 | 200 | 등록 원본 이미지 바이너리 |
| POST | `/upload` | 불필요 | 200 | 이미지 검증·전처리 메타데이터 |
| POST | `/recognize` | 불필요 | 200 | 작품·명패 인식 후보 조회. 호출 제한은 접속 IP 기준 |
| GET | `/artworks/{artwork_id}/narration` | 불필요 | 200 | 등록 작품 검수 해설·TTS 텍스트 |
| POST | `/analyze` | 불필요 | 200 | 미등록 작품의 실시간 해설. 호출 제한은 접속 IP 기준 |
| POST | `/correction` | 불필요 | 200 JPEG | AI 이미지 보정. 현재 AI 함수 미연결 |
| POST | `/me/history` | 필요 | 201 | 관람 기록 등록 (앱 미사용) |
| GET | `/me/history` | 필요 | 200 | 내 관람 기록 목록 (앱 미사용) |
| DELETE | `/me/history/{history_id}` | 필요 | 204 | 내 관람 기록 삭제 (앱 미사용) |

모든 입력 검증 API는 422를 반환할 수 있습니다. 인증 API는 401을 공통 처리합니다.

## 3. 회원 인증

### POST /auth/register

JSON 필수 필드:

| 필드 | 타입 | 제한 |
|---|---|---|
| `email` | string | 유효한 이메일. 소문자로 정규화 |
| `password` | string | 8~128자 |
| `nickname` | string | 앞뒤 공백 제거 후 1~40자 |

```json
{
  "email": "visitor@example.com",
  "password": "example-password-123",
  "nickname": "관람객"
}
```

성공 **201** (`LoginResult`):

```json
{
  "access_token": "발급된_세션_토큰",
  "token_type": "bearer",
  "expires_in": 604800,
  "user": {
    "id": "7cf23831-c48d-4579-a223-53341c548477",
    "email": "visitor@example.com",
    "nickname": "관람객",
    "created_at": "2026-11-03T00:00:00+00:00"
  }
}
```

오류: **409** 이미 가입된 이메일 / **422** 입력 오류 / **429** 인증 요청 제한.
회원가입 성공 즉시 로그인 상태입니다. 이메일 인증 메일 발송은 없습니다.

### POST /auth/login

JSON: `email`, `password` 필수. 제약은 회원가입과 같습니다.
성공 **200**: 위 `LoginResult`와 동일하며 새 토큰을 발급합니다.
오류: **401** 이메일 또는 비밀번호 불일치 / **422** 입력 오류 / **429** 인증 요청 제한.

### POST /auth/logout

Bearer 인증, 요청 본문 없음. 성공 **204**, 응답 본문 없음.
응답에 `response.json()`을 호출하지 않습니다. **401**이면 이미 무효인 세션이므로 FE의 토큰도 정리합니다.

### GET /me

Bearer 인증, 요청 본문 없음. 성공 **200**: 위 `LoginResult.user`와 동일한 `id`, `email`, `nickname`, `created_at` 객체.

## 4. 프로필

### GET /me/profile · PUT /me/profile

Bearer 인증. GET은 현재 앱 설정, PUT은 아래 JSON 저장 후 저장된 전체 객체를 **200**으로 반환합니다.
**PUT은 전체 교체**입니다. 생략 필드는 기본값으로 초기화되므로 기존 값을 읽어 수정한 전체 객체를 전송합니다.
알 수 없는 필드·허용 범위 밖 값은 **422**입니다.

| 필드 | 타입·범위 | 기본값 |
|---|---|---|
| `color_vision` | `normal`, `protanopia`, `deuteranopia`, `tritanopia` | `normal` |
| `color_severity` | number, 0~1 | 0 |
| `strength` | number, 0~1 | 1 |
| `contrast` | number, 0.5~2 | 1 |
| `brightness` | number, -1~1 | 0 |
| `sharpen` | number, 0~2 | 0 |
| `zoom` | number, 1~8 | 1 |
| `narration_mode` | `facts`, `interpretations`, `both` | `both` |
| `speech_rate` | number, 0.75~1.5 | 1 |
| `high_contrast` | boolean | false |

```json
{
  "color_vision": "normal",
  "color_severity": 0,
  "strength": 1,
  "contrast": 1,
  "brightness": 0,
  "sharpen": 0,
  "zoom": 1,
  "narration_mode": "both",
  "speech_rate": 1,
  "high_contrast": false
}
```

이 설정의 이미지 반영·확대·음성 속도 적용은 FE에서 수행합니다.

### GET /me/ai-profile · PUT /me/ai-profile

Bearer 인증. **기존 `/me/profile`과 독립적으로 저장**합니다. 필드명·밝기 단위를 자동 변환하지 않습니다.
GET은 미설정 시 **200 + `null`**, 설정 이후에는 아래 객체를 반환합니다.
PUT은 전체 교체이며 생략 필드는 기본값으로 저장합니다. 응답 **200**은 저장된 전체 객체입니다.
기본값은 사용자 설정 시작값이며 색각 진단 결과가 아닙니다. 허용하지 않은 필드·값은 **422**입니다.

| 필드 | 타입·범위 | 기본값 |
|---|---|---|
| `color_type` | `normal`, `protan`, `deutan`, `tritan` | `normal` |
| `severity` | number, 0~1 | 0 |
| `contrast` | number, 0.5~2 | 1 |
| `brightness` | number, -50~50 | 0 |
| `sharpness` | number, 0~2 | 0 |
| `edge` | number, 0~1 | 0 |

```json
{
  "color_type": "deutan",
  "severity": 0.5,
  "contrast": 1.2,
  "brightness": 10,
  "sharpness": 0.5,
  "edge": 0.3
}
```

## 5. 작품 조회

### 공통 ArtworkDetail

목록의 `items`, ID 조회, 번호 조회에 같은 객체를 사용합니다.
다음 예시는 응답 구조를 설명하기 위한 샘플입니다. 작품·해설·평가 데이터는 실제 준비 상태에 따라 다릅니다.

```json
{
  "id": "mona-lisa",
  "title": "모나리자",
  "artist": "레오나르도 다 빈치",
  "year": null,
  "number": "INV 779",
  "museum": "루브르 박물관",
  "museum_id": "louvre",
  "background": null,
  "source_url": null,
  "license": null,
  "description": null,
  "review_status": "pending",
  "image_url": "http://127.0.0.1:8000/images/파일해시.webp"
}
```

- `id`, `title`, `artist`, `image_url`: string.
- `title`, `artist`는 앱에 보이는 한국어 이름입니다. `original_title`, `original_artist`: 원제·원어 작가명(실제 명패 언어), string 또는 null. 명패 인식은 두 이름을 모두 비교합니다.
- `year`, `number`, `museum`, `museum_id`, `background`, `source_url`, `license`: string 또는 null. `year`는 숫자 타입이 아닙니다.
- `number`는 소장번호이며 문자열입니다. `007`을 `7`로 변환하지 않습니다.
- `review_status`: `pending | reviewed`. 미검수이면 `description=null`입니다.
- `description`: 7장의 공통 해설 객체 또는 null.
- `image_url`은 반환된 URL을 사용합니다. `/images/{filename}`은 JPEG·PNG·WebP 바이너리이며 없는 파일은 404입니다.

### GET /museums

인증 불필요. Query `limit` 기본 20(1~100), `offset` 기본 0(0 이상).
성공 **200** 예: `{"items":[{"id":"louvre","name":"루브르 박물관","area":"프랑스 파리","artwork_count":1}],"total":1,"limit":20,"offset":0}`.
등록 작품이 있는 미술관만 ID 오름차순으로 반환합니다. `area`는 카탈로그 작품의 `museum_area`(예: `미국 뉴욕`)이며, 없으면 빈 문자열입니다.
카탈로그에 `museum_id`를 명시하는 것을 권장합니다. 기존 미술관명만 있는 데이터는 서버 시작 시
`museum-` + 미술관명 UTF-8 SHA256 앞 20자리로 ID를 자동 생성합니다. 이름을 바꾸더라도 발급된 ID를 유지합니다.
미술관 없는 작품은 `museum_id=null`이며 목록에 포함하지 않습니다.

### GET /artworks

Query: `limit` 기본 20(1~100), `offset` 기본 0(0 이상), `museum_id` 선택(미술관 목록의 ID).
미술관을 지정하면 해당 작품만 조회하며 없는 ID는 빈 목록입니다.
성공 **200**: `{ "items": ArtworkDetail[], "total": number, "limit": number, "offset": number }`.
작품 ID 오름차순이며 비어 있으면 `items=[]`, `total=0`입니다. 오류 **422**.

### GET /artworks/{artwork_id}

Path: `artwork_id` string. 성공 **200**: `ArtworkDetail`. 오류 **404** 작품 없음.

### GET /artworks/by-number

| Query | 타입 | 필수 | 설명 |
|---|---|---|---|
| `number` | string, 1자 이상 | 필수 | 작품 번호. 정확히 일치하는 값 |
| `museum_id` | string, 1자 이상 | 선택 | `/museums`에서 받은 ID. 새 FE는 이 필드 사용 |
| `museum` | string, 1자 이상 | 선택 | 기존 연동용 미술관명. ID와 함께 보내면 두 조건 모두 적용 |

예: `/artworks/by-number?museum_id=louvre&number=007`. 한글·공백은 `URLSearchParams`로 인코딩합니다.
`museum` 미선택 시 빈 문자열 대신 파라미터를 생략합니다. 입력 앞뒤 공백은 FE에서 제거합니다.
성공 **200**: `ArtworkDetail`.
오류: **404** 해당 번호·미술관 조합 없음 / **409** 여러 미술관의 번호 중복, 미술관 지정 필요 / **422** 번호 누락·빈 값.
409 응답에는 후보 목록이 없으므로 `/museums`에서 미술관을 선택합니다.
404는 번호 조회 실패이며 촬영 이미지의 미등록 판정을 뜻하지 않습니다.

### QR 내용 계약

QR 내용은 **`momi://artwork/<artwork_id>`**로 확정합니다. 예: `momi://artwork/mona-lisa`.
`artwork_id`는 작품 번호가 아니라 카탈로그 ID(`[a-z0-9][a-z0-9_-]{0,79}`)입니다.
FE는 scheme=`momi`, host=`artwork`, 경로의 단일 ID를 검증한 뒤
`GET /artworks/{artwork_id}`를 호출합니다. query·fragment·추가 경로와 단순 ID 문자열은 지원하지 않습니다.
다른 URL을 열거나 그대로 API 주소로 사용하지 않습니다. 미등록 ID는 404 안내로 연결합니다.
이 계약은 QR 페이로드이며 OS 딥링크 라우팅·카메라 스캔은 FE에서 연결합니다.

## 6. 이미지 입력·작품 인식

### POST /upload

인증 불필요. multipart 필수 필드 `image`: 파일.
성공 **200** 예시(크기 값은 설명용):

```json
{
  "filename": "capture.png",
  "size_bytes": 150000,
  "source_format": "PNG",
  "normalized_filename": "capture.jpg",
  "format": "JPEG",
  "content_type": "image/jpeg",
  "normalized_size_bytes": 120000,
  "width": 1024,
  "height": 768,
  "mode": "RGB"
}
```

변환 이미지 파일·URL·업로드 ID는 반환하지 않습니다. 검증용 메타데이터만 반환합니다.
오류: **400** 빈 파일·손상 이미지 / **413** 용량·화소 초과 / **415** 지원하지 않는 형식 / **422** 파일 누락.

### POST /recognize

인증 없음(앱은 로그인 없이 기기 로컬 저장만 사용). 호출 제한은 접속 IP 기준. multipart:

| Form | 타입 | 필수 | 기본값·설명 |
|---|---|---|---|
| `image` | 파일 | 필수 | 작품 또는 명패 사진 |
| `mode` | `artwork`, `placard` | 선택 | 기본 `artwork`. 사진은 CLIP, 명패는 Gemini 텍스트 추출 후 매칭 |

성공 **200** 예시(점수·품질 수치는 측정 결과가 아닌 구조 예시):

```json
{
  "mode": "artwork",
  "candidates": [
    {
      "artwork_id": "mona-lisa",
      "title": "모나리자",
      "artist": "레오나르도 다 빈치",
      "score": 0.72,
      "image_url": "http://127.0.0.1:8000/images/파일해시.webp"
    }
  ],
  "score_type": "cosine_similarity",
  "status": "needs_confirmation",
  "confidence": "medium",
  "quality": {
    "laplacian_variance": 150,
    "highlight_ratio": 0.05,
    "warnings": [],
    "artwork_bbox": null,
    "framing_hint": null,
    "note": "품질 경고는 규칙 기반 참고값이며 인식을 차단하지 않습니다."
  },
  "match_threshold": null
}
```

- `candidates`: 점수 내림차순 최대 3개. 비어 있을 수 있습니다. 작품 전체 정보는 상세 API로 조회합니다.
- 사진 `score_type=cosine_similarity`, 명패 `score_type=fuzzy_text_similarity`.
- 점수는 확률이 아니므로 정확도 %로 표시하지 않습니다. 사진 점수 범위 -1~1, 명패 점수 0~1입니다.
- `confidence=high`: 바로 첫 후보 작품으로 이동. `status=matched`.
- `confidence=medium`: 후보 확인 시트. `status=needs_confirmation`.
- `confidence=low`: 후보 없음·미등록 안내. `status=no_match`, `candidates=[]`.
- 사진 모드에서 실제 촬영본 평가 후 `CLIP_MATCH_THRESHOLD`(미만이면 low), `CLIP_HIGH_CONFIDENCE_THRESHOLD`(이상이면 high)를 설정합니다. high는 match 이상이어야 합니다. 기준 미설정이면 후보가 있는 응답은 항상 medium입니다. 명패도 후보가 있으면 medium, OCR 매칭 후보가 없으면 low입니다.
- 현재 실제 촬영 평가값이 없어 두 환경변수 기본값은 비어 있습니다. 임의의 high 기준은 넣지 않습니다.
- `no_match`: 후보 없음. 사진 모드에서 임계값이 설정되고 최고 점수가 기준보다 낮아도 이 상태와 빈 후보를 반환합니다.
- `match_threshold`: 설정된 사진 임계값 또는 null. 명패는 항상 null. 평가 전 임의 기준값을 넣지 않습니다.
- `quality.artwork_bbox`: 회전 보정된 **촬영본** 대비 `[x,y,width,height]`, 0~1 비율. 등록 원본과 최고 후보의 ORB 특징점·RANSAC 투영이 충분히 검증될 때만 반환합니다. 명패·후보 없음·특징 부족·작품 잘림·위치 추정 실패는 null입니다. confidence와 별개인 보조 정보이며 작품 확정 근거로 쓰지 않습니다.
- `quality.framing_hint`: 카메라를 움직일 방향. `move_left`(조금 왼쪽), `move_right`, `move_up`, `move_down`, `move_closer`, `move_back`, `hold_still` 또는 null. bbox가 확인되지 않으면 null입니다. 중심이 0.4~0.6 밖이면 중심 맞춤을 우선하고, 중앙에서는 면적 25% 미만이면 가까이, 너비·높이 95% 초과면 뒤로 안내합니다. 기기 기울기/회전 각도는 제공하지 않습니다.
- `quality.warnings`: 흐림·반사 가능성 안내용 문자열 배열. 재촬영을 안내할 수 있으며 서버는 인식을 차단하지 않습니다.
- 미등록 해설을 원하면 FE가 촬영본을 다시 `/analyze`로 전송합니다. 이 API가 Gemini 해설까지 자동 생성하지 않습니다.

오류: 공통 이미지 오류, **503** 작품·CLIP 의존성·모델·인덱스 미준비 또는 카탈로그와 인덱스 불일치.
명패 모드는 Gemini 오류(**429/502/503/504**)도 발생합니다.

## 7. 해설

### 공통 Description

```json
{
  "facts": ["붉은 형태가 있습니다."],
  "interpretations": ["따뜻하게 느껴질 수 있습니다."],
  "regions": [
    {"label": "붉은 형태", "bbox": [0.1, 0.2, 0.3, 0.4], "color": "붉은색"}
  ],
  "mood_keywords": ["따뜻함"],
  "fact_region_indices": [0],
  "interpretation_region_indices": [null]
}
```

`facts`, `interpretations`, `mood_keywords`는 string 배열입니다. `regions`는 객체 배열이며 정확한 영역이 없으면 비어 있습니다.
`bbox=[왼쪽 x, 위쪽 y, 너비, 높이]`는 전체 이미지 대비 0~1 비율입니다. `[x1,y1,x2,y2]`가 아닙니다.
너비·높이는 양수이고 이미지 경계를 넘지 않습니다. 등록 작품은 원본, 실시간 분석은 회전 보정한 촬영본 기준입니다.
화면에 배치할 때 이미지의 실제 표시 영역·여백·줌 변환을 반영합니다.
`fact_region_indices`, `interpretation_region_indices`는 각각 문장 배열과 길이가 같은 영역 연결 배열입니다.
항목은 `regions`의 0부터 시작하는 인덱스 또는 null(전체 설명·연결 불명)입니다.
배열 자체도 null일 수 있습니다(기존 데이터). 길이·인덱스 범위는 AI 응답과 카탈로그 등록 시 검증합니다.
AI가 생성한 영역 연결도 사람이 검수한 뒤 등록합니다.

### GET /artworks/{artwork_id}/narration

인증 없음. Path `artwork_id` 필수.
Query `mode`: `facts | interpretations | both`, 선택. 기기에 저장한 감상 모드를 보내며 생략 시 `both`.
성공 **200**:

```json
{
  "artwork_id": "mona-lisa",
  "mode": "both",
  "segments": [
    {"type": "fact", "text": "붉은 형태가 있습니다.", "region_index": 0},
    {"type": "interpretation", "text": "가능한 감정적 해석입니다. 따뜻하게 느껴질 수 있습니다.", "region_index": null}
  ],
  "text": "붉은 형태가 있습니다.\n가능한 감정적 해석입니다. 따뜻하게 느껴질 수 있습니다.",
  "review_status": "reviewed"
}
```

DB의 검수 해설만 읽으며 Gemini를 호출하지 않습니다. 음성 파일은 반환하지 않습니다.
`text` 또는 `segments`를 FE의 expo-speech로 재생합니다.
각 segment의 `region_index`는 작품 상세 `description.regions`의 인덱스입니다.
null이면 영역을 강조하지 않습니다. 모드를 필터해도 인덱스는 바뀌지 않습니다.
기존 해설에 연결 데이터가 없으면 null이며 문장 순서로 위치를 추측하지 않습니다.
오류: **404** 작품 없음 / **409** 검수 해설 없음 / **422** 잘못된 mode.

### POST /artworks/{artwork_id}/narration

2026-11-11 추가. 등록 작품의 AI 해설 생성. 인증·요청 본문은 없으며 Path `artwork_id`만 필요합니다.
서버에 저장된 원본과 제목·작가·연도 메타데이터를 Gemini에 전달합니다.

성공 **200**은 위 GET의 `artwork_id`, `mode: "both"`, `segments`, `text`에 다음 필드가 추가됩니다.

- `description`: 생성된 사실·해석·영역 등 전체 해설 객체.
- `review_status: "unreviewed"`: 생성 결과를 검수된 해설로 표시하면 안 됩니다.
- `warning`: 미검수 AI 해설 안내 문장.
- `fallback`: 생성 실패 안내인지 여부. true이면 `segments: []`, `text: ""`이며 재생하지 않습니다.

DB의 기존 작품·검수 상태는 변경하지 않습니다. 생성 해설 JSON은 `data/generated-media.sqlite3`에 별도 저장하며, 음성은 FE의 `/speech` 요청으로 생성·저장합니다.
응답은 `Cache-Control: no-store`이지만 서버는 성공한 해설을 SQLite에서 재사용하므로 재시작 후에도 재생성하지 않습니다. 작품 원본·메타데이터·모델·캐시 규격이 바뀌면 새로 생성합니다. fallback·빈 해설·실패는 저장하지 않습니다. 동일 작품의 동시 요청은 서버 프로세스 안에서 생성 작업을 공유합니다.
새로 생성할 때만 기존 AI 공통 분당 5회 제한과 Gemini 예산·하루 호출 상한을 사용하며, DB 캐시 조회는 이를 소모하지 않습니다.
오류: **404** 작품 없음 / **429** 사용 한도 / **502** 외부 연결·응답 오류 / **503** 키·모델 미설정 또는 사용 불가 / **504** 시간 초과.

FE는 기존 GET이 409일 때 ‘AI 해설 생성하기’를 제공합니다. 자동 생성 요청을 반복하지 않으며 오류 시 명시적으로 재시도합니다.
iPhone의 기기 TTS는 무음 모드에서 소리가 나지 않을 수 있어 재생 화면에서 무음·음량 확인을 안내합니다.

### POST /analyze

인증 없음(호출 제한은 접속 IP 기준). multipart 필수 필드 `image`: 미등록 작품 사진. `mode`·작품명 입력 필드는 없습니다.
성공 **200**:

```json
{
  "description": {
    "facts": ["붉은 형태가 있습니다."],
    "interpretations": ["따뜻하게 느껴질 수 있습니다."],
    "regions": [],
    "mood_keywords": ["따뜻함"]
  },
  "review_status": "unreviewed",
  "warning": "AI가 생성한 미검수 해설로 사실과 다른 내용이 포함될 수 있습니다.",
  "fallback": false
}
```

작가·제목·연대 등을 추측하지 않는 시각 해설입니다. DB에 저장하지 않습니다.
사실·해석 모드 전환은 반환된 배열 중 표시·재생할 항목을 FE에서 선택합니다.
JSON 스키마 검증이 실패하면 1회 재시도하고, 다시 실패하면 **200**과 아래 객체를 반환합니다.

```json
{
  "description": {
    "facts": ["해설을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."],
    "interpretations": [],
    "regions": [],
    "mood_keywords": []
  },
  "review_status": "unreviewed",
  "warning": "AI가 생성한 미검수 해설로 사실과 다른 내용이 포함될 수 있습니다.",
  "fallback": true
}
```

`fallback=true`는 해설 생성 실패입니다. 성공 해설로 표시·저장하지 않고 재시도 안내를 보여줍니다.
API 키·한도·네트워크·타임아웃 오류에는 fallback을 적용하지 않고 **429/502/503/504**를 반환합니다.
Gemini 요청은 한 번당 타임아웃 45초, 재시도 포함 최대 2회이므로 FE에서도 대기·취소 UI를 준비합니다.

## 8. 이미지 보정

### POST /correction

인증 없음. **현재 AI 함수가 없으므로 정상 입력도 503**입니다. 기존 앱 Skia 보정은 계속 사용할 수 있습니다.
multipart:

| Form | 타입 | 필수·규칙 |
|---|---|---|
| `artwork_id` | string | 등록 작품 원본을 사용할 때 전송 |
| `image` | 파일 | 미등록 촬영본을 사용할 때 전송. artwork_id와 정확히 하나만 전송 |
| `profile` | string | 필수. 기기에 저장한 4장의 AI 프로필 JSON을 `JSON.stringify()`한 문자열 |

`profile`이 없으면 **422**입니다. 프로필은 서버에 저장하지 않으므로 요청마다 보냅니다.
연결 후 성공 **200**, `Content-Type: image/jpeg`, JPEG 바이너리이며 JSON이 아닙니다.
이미지는 회전·RGB 전처리 후 입력과 같은 크기이고 저장 URL을 발급하지 않습니다.

```ts
const body = new FormData();
body.append("artwork_id", "mona-lisa");
body.append("profile", JSON.stringify(aiProfile));
const response = await fetch(`${BASE_URL}/correction`, { method: "POST", body });
if (!response.ok) {
  // 실패 응답은 JSON 오류로 처리
  throw new Error(`보정 실패: ${response.status}`);
}
const jpeg = await response.blob(); // 웹 예시. 네이티브는 앱의 이미지 로딩 방식에 맞춰 사용
```

오류: 공통 인증·이미지 오류, **404** 작품 없음 /
**422** image·artwork_id 조합 또는 profile JSON 오류 / **429** 호출 제한 /
**502** AI 출력 형식·크기 오류 / **503** 보정 함수 미연결.

## 9. 관람 기록

### POST /me/history

Bearer 인증. JSON:

| 필드 | 타입 | 규칙 |
|---|---|---|
| `artwork_id` | string | 필수, 1~80자. 작품 번호가 아닌 작품 ID |
| `profile` | 앱 프로필 객체 또는 null | 선택. 생략·null이면 현재 계정 앱 설정으로 기록 |

```json
{"artwork_id": "mona-lisa"}
```

성공 **201**: 아래 HistoryEntry. 예시의 `profile`은 실제 응답에서 4장의 앱 프로필 전체 필드를 포함합니다.

```ts
interface HistoryEntry {
  id: string;
  artwork_id: string;
  profile: VisualProfile; // 4장의 앱 프로필 전체 객체
  ai_profile: AIProfile | null; // 4장의 AI 프로필 전체 객체
  viewed_at: string;
}
```

AI 프로필은 요청 필드가 없으며 현재 계정의 저장값을 자동 스냅샷합니다. 미설정이면 null입니다.
기록 이후 계정 설정을 바꿔도 과거 기록의 설정은 유지됩니다.
같은 작품의 반복 기록을 허용합니다. 미등록 작품은 저장할 수 없으며 **404**입니다.

### GET /me/history

Bearer 인증. Query `limit`, `offset`은 공통 페이지네이션 규칙 사용.
성공 **200**: `{ "items": HistoryEntry[], "total": number, "limit": number, "offset": number }`.
내 기록만 최신 감상 시간순으로 반환합니다. 기존 기록의 `ai_profile`은 null일 수 있습니다.
제목·작가·이미지 URL은 기록에 없으므로 `artwork_id`로 작품 상세를 조회합니다.

### DELETE /me/history/{history_id}

Bearer 인증. Path `history_id`: 관람 기록 ID. 요청 본문 없음.
성공 **204**, 응답 본문 없음. **404** 기록 없음 또는 다른 회원 소유 기록.

## 10. 서버 상태·오류·호출 제한

### GET /health

성공 **200**: `{ "status": "ok" }`. 프로세스 연결 확인이며 Gemini·CLIP 모델·인덱스 준비를 보장하지 않습니다.

### 오류 응답

일반 오류:

```json
{"detail": "등록된 작품을 찾을 수 없습니다."}
```

자동 검증 오류는 `detail`이 배열일 수 있습니다. 직접 발생시킨 422는 문자열일 수도 있으므로 두 형식을 처리합니다.

```json
{
  "detail": [
    {"type": "missing", "loc": ["query", "number"], "msg": "Field required", "input": null}
  ]
}
```

| HTTP | FE 처리 |
|---|---|
| 400 | 빈 파일·손상 이미지 확인 |
| 401 | 토큰 무효·만료 또는 로그인 실패. API 맥락에 맞춰 재로그인·입력 확인 |
| 404 | 작품·번호·기록 없음 안내 |
| 409 | 이메일 중복, 미술관 선택 필요, 검수 해설 없음, AI 프로필 미설정 등 API별 처리 |
| 413 | 이미지 용량·화소 축소 후 재전송 |
| 415 | 지원 형식으로 변환 |
| 422 | 필수 입력·범위·형식 확인 |
| 429 | 재시도 대기. `Retry-After`가 있으면 해당 초만큼 대기 |
| 502 | 외부 AI 응답·연결 또는 보정 출력 오류. 재시도 안내 |
| 503 | 키·모델·인덱스·AI 함수 등 서버 준비 상태 또는 동시 호출 한도 확인 |
| 504 | AI 응답 시간 초과. 재시도 안내 |

등록·로그인은 서버가 인식하는 클라이언트 IP 기준 **분당 10회 공유**입니다.
`/analyze`, 명패 `/recognize`, `/correction`은 사용자 기준 **분당 5회 공유**입니다.
사진 모드 `/recognize`는 별도로 사용자당 **60초 동안 60회**를 허용합니다. 1~2초 자동 촬영을 지원하며 초과 시 429 + `Retry-After: 60`입니다.
사진 처리 전체(전처리·CLIP·위치 추정)는 프로세스당 **1개**만 실행합니다. 처리 중 추가 요청은 대기열에 넣지 않고 **503 + `Retry-After: 2`**로 반환합니다.
FE는 응답이 끝난 뒤 다음 촬영을 예약하고 429/503에서는 Retry-After만큼 대기합니다. 확인 시트·화면 이탈·앱 백그라운드에서는 촬영을 중단합니다.
자동 반복은 `mode=artwork`에만 사용합니다. Gemini를 호출하는 명패 모드는 수동 요청으로 유지합니다.
실측 범위와 배포 전 검증은 [자동 촬영 부하 기록](recognition-load.md)을 참고합니다.
Gemini 외부 호출 동시 실행은 프로세스당 2개입니다. 제한은 단일 서버 프로세스 기준입니다.
FE는 자동 무한 재시도를 하지 않고 대기·수동 재시도를 제공합니다.

## 11. 화면 연결 순서

1. 회원가입 또는 로그인 → 토큰 저장 → `/me/profile`, `/me/ai-profile` 조회.
2. 앱 설정은 `/me/profile`, AI 보정 설정은 `/me/ai-profile`에 각각 저장.
3. `/museums`에서 미술관 선택 → `/artworks?museum_id=...` 또는 `/artworks/by-number?museum_id=...&number=...`. QR은 ID 추출 후 작품 상세 조회. 사진·명패는 `/recognize`.
4. confidence에 따라 바로 이동·후보 확인·미등록 안내로 분기. 선택 후 작품 ID로 상세·원본 조회 → `/narration` 텍스트를 TTS 재생.
5. `no_match`라면 촬영본으로 `/analyze` 호출 → 미검수·fallback 상태를 구분해 표시.
6. 등록 작품 감상 시 `/me/history` 등록. 미등록 감상 저장은 현재 지원하지 않음.
7. AI 보정 함수 연결 전까지 `/correction`의 503을 처리하고 앱 Skia 보정 사용.

개발 서버 실행 방법은 [Backend README](../Backend/README.md)를 참고합니다.

## 12. React Native 연결 예시

### 서버 주소 설정

명세의 `BASE_URL`은 FE에서 정하는 서버 주소입니다. 휴대폰에서 `127.0.0.1`은 휴대폰 자신을 가리키므로
PC의 로컬 IP 또는 공유된 ngrok 주소를 사용합니다. ngrok 주소가 바뀌면 FE 설정도 갱신합니다.
기존 FE의 `EXPO_PUBLIC_UPLOAD_URL`은 전처리 테스트용 `/upload` 전체 URL이며 전체 API Base URL과 구분합니다.
`EXPO_PUBLIC_API_URL`은 현재 FE의 공통 설정입니다.

```dotenv
EXPO_PUBLIC_API_URL=https://공유받은주소.ngrok-free.app
```

```ts
const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL;
if (!configuredBaseUrl) throw new Error("API 서버 주소를 설정해 주세요.");
const BASE_URL = configuredBaseUrl.replace(/\/+$/, "");
```

공개 FE 환경변수에는 서버 주소만 넣습니다. Gemini 키는 서버에서 관리합니다.
웹 FE의 출처가 달라지면 BE의 `CORS_ORIGINS`에도 해당 웹 출처를 추가해야 합니다.

### 촬영본으로 작품 인식 요청

아래는 기존 FE 파일 업로드 방식과 같은 React Native FormData 예시입니다.
`uri`, `name`, `type`은 실제 파일 형식과 일치시킵니다. JPEG로 리사이즈한 결과를 보내는 경우의 예시입니다.

```ts
import { File } from "expo-file-system";

async function recognizePhoto(uri: string) {
  const body = new FormData();
  // Expo SDK 58의 fetch는 RN식 { uri, name, type } 객체를 보내지 못한다
  // ("Unsupported FormDataPart implementation"). expo-file-system의 File을 넣는다.
  body.append("image", new File(uri) as unknown as Blob);
  body.append("mode", "artwork");

  const response = await fetch(`${BASE_URL}/recognize`, { method: "POST", body });
  const data = await response.json();
  if (!response.ok) {
    // 실제 앱에서는 status와 detail을 10장의 규칙에 따라 화면 상태로 매핑
    throw new Error(`작품 인식 실패 (${response.status})`);
  }
  return data;
}
```

`as unknown as Blob`은 React Native의 `{ uri, name, type }` 파일 객체를 DOM 타입 선언과 맞추기 위한 단언입니다.
웹에서는 이 객체 대신 실제 `File` 또는 `Blob`을 append합니다.
`/analyze`도 같은 `image` 파일 필드로 전송하며, 명패 인식은 `mode=placard`로 변경합니다.

### 응답 종류별 분기

| 요청 | 성공 본문 읽기 | 주의 |
|---|---|---|
| JSON API | `response.json()` | 먼저 status로 성공·실패 구분. 200의 fallback도 확인 |
| 로그아웃·기록 삭제 | 읽지 않음 | 204는 JSON 본문 없음 |
| `/correction` | JPEG 바이너리 | 성공만 바이너리. 오류는 detail을 가진 JSON |
| `image_url` | 이미지 컴포넌트의 source | API JSON으로 파싱하지 않음 |

네트워크 단절·프록시 오류는 JSON이 아닐 수 있으므로 공통 요청 함수는 JSON 파싱 실패도 처리합니다.

## 13. 요청 재시도와 화면 상태

| 상황 | FE 동작 |
|---|---|
| 앱 시작 | 저장된 토큰이 있으면 `/me` 등 인증 API로 확인. 401이면 토큰 정리·재로그인 |
| 프로필 저장 | 전체 객체를 전송하고 성공 응답을 캐시에 반영. 여러 저장 요청이 겹치지 않게 처리 |
| 인식 결과 | `confidence` high는 바로 이동, medium은 확인 시트 유지, low는 미등록 안내 |
| 미등록·후보 없음 | `no_match`이면 작품명 확정 없이 촬영본 분석 또는 재촬영 선택 제공 |
| 미검수 해설 | `fallback=false`여도 `unreviewed` 표시. 검수된 등록 해설과 구분 |
| 해설 생성 실패 | `fallback=true`이면 기본 안내 표시·수동 재시도 제공 |
| 화면 이탈·요청 취소 | 늦게 도착한 응답이 다른 작품 화면을 덮어쓰지 않게 처리 |

관람 기록 등록에는 중복 방지 키가 없으며 같은 요청을 다시 보내면 새 기록이 생깁니다.
네트워크 오류로 성공 여부를 모를 때 무조건 자동 재전송하지 않습니다. 로그아웃·기록 삭제를 다시 호출하면
각각 401·404가 나올 수 있습니다. 프로필 PUT은 같은 값을 재전송할 수 있지만 생략 필드가 기본값으로 돌아가는 점에 유의합니다.
FE에서 요청을 취소해도 서버의 Gemini 작업·사용량까지 취소된다고 보장하지 않습니다.

현재 지원하지 않는 API는 토큰 갱신, 비밀번호 재설정, 회원 탈퇴,
미등록 작품 관람 기록, 관람 기록 수정, FE의 작품 카탈로그 업로드·등록입니다.
카탈로그 등록은 BE 관리자 CLI로 수행합니다. 시각 프로필은 사용자 설정이며 색각 진단 결과 API는 없습니다.

## OpenAI 음성 생성 (2026-11-11)

`POST /speech`, 로그인 불필요, JSON `{"text": "읽을 해설 한 문장"}`. 공백 제거 후 1~600자이며 다른 필드는 허용하지 않습니다.
성공 **200**은 JSON이 아닌 `audio/wav` 바이너리(24kHz, mono, PCM16)입니다. `X-Voice-Cache-Key`는 모델·목소리·문장에 따른 SHA-256 캐시 키이고 `Cache-Control: no-store`입니다.

오류: **422** 입력 오류 / **429** IP 호출 제한·OpenAI 예산·하루 횟수·외부 한도 / **502** 생성·연결 실패·원문과 다른 transcript / **503** OpenAI 키·모델 미설정 또는 동시 생성 슬롯 소진 / **504** 생성 시간 초과.
Gemini와 별도 OpenAI 키·예산을 사용합니다. API 키는 서버 환경변수에서만 읽으며 FE는 키를 받지 않습니다. 성공 음성 WAV는 서버의 `data/generated-media.sqlite3`에도 저장합니다. 동일 모델·목소리·지침·문장은 서버 재시작 이후에도 DB에서 반환하며 외부 호출·생성 비용이 없습니다. 저장된 음성 조회에는 OpenAI 키나 잔여 생성 예산이 필요하지 않습니다. 실패한 음성은 저장하지 않습니다. 앱은 캐시 파일로 재생하고, 속도 변경·문장 반복 시 외부 API를 다시 호출하지 않습니다.
화면에 OpenAI가 생성한 AI 음성임을 알립니다. OpenAI 연결 실패 시 다른 목소리로 대신 재생하지 않고 오류를 보여 줍니다. 해설뿐 아니라 화면 안내·카메라 안내 등 앱의 모든 음성이 `/speech`를 사용합니다. 스크린리더가 켜져 있으면 안내는 스크린리더로 읽습니다.
