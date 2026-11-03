# SWAITHON FE API 명세서

기준일: 2026-11-03. **이 문서와 함께 커밋한 백엔드 코드 기준**입니다. 배포 서버의 반영 상태는 별도로 확인합니다.
AI 프로필·보정·해설 fallback·CLIP 임계값 분기를 포함합니다.
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
| 인증 | 필요한 API에 `Authorization: Bearer {access_token}` |
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

| Method | Path | 인증 | 성공 | 용도 |
|---|---|---|---|---|
| GET | `/health` | 불필요 | 200 | 서버 연결 확인 |
| POST | `/auth/register` | 불필요 | 201 | 회원가입 및 토큰 발급 |
| POST | `/auth/login` | 불필요 | 200 | 로그인 |
| POST | `/auth/logout` | 필요 | 204 | 현재 세션 로그아웃 |
| GET | `/me` | 필요 | 200 | 내 회원 정보 |
| GET | `/me/profile` | 필요 | 200 | 앱 시각·음성 설정 조회 |
| PUT | `/me/profile` | 필요 | 200 | 앱 설정 전체 저장 |
| GET | `/me/ai-profile` | 필요 | 200 | AI 6필드 프로필 조회 |
| PUT | `/me/ai-profile` | 필요 | 200 | AI 프로필 전체 저장 |
| GET | `/artworks` | 불필요 | 200 | 등록 작품 목록 |
| GET | `/artworks/by-number` | 불필요 | 200 | 작품 번호·미술관 조회 |
| GET | `/artworks/{artwork_id}` | 불필요 | 200 | 작품 상세 |
| GET | `/images/{filename}` | 불필요 | 200 | 등록 원본 이미지 바이너리 |
| POST | `/upload` | 불필요 | 200 | 이미지 검증·전처리 메타데이터 |
| POST | `/recognize` | 필요 | 200 | 작품·명패 인식 후보 조회 |
| GET | `/artworks/{artwork_id}/narration` | 필요 | 200 | 등록 작품 검수 해설·TTS 텍스트 |
| POST | `/analyze` | 필요 | 200 | 미등록 작품의 실시간 해설 |
| POST | `/correction` | 필요 | 200 JPEG | AI 이미지 보정. 현재 AI 함수 미연결 |
| POST | `/me/history` | 필요 | 201 | 관람 기록 등록 |
| GET | `/me/history` | 필요 | 200 | 내 관람 기록 목록 |
| DELETE | `/me/history/{history_id}` | 필요 | 204 | 내 관람 기록 삭제 |

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
  "background": null,
  "source_url": null,
  "license": null,
  "description": null,
  "review_status": "pending",
  "image_url": "http://127.0.0.1:8000/images/파일해시.webp"
}
```

- `id`, `title`, `artist`, `image_url`: string.
- `year`, `number`, `museum`, `background`, `source_url`, `license`: string 또는 null. `year`는 숫자 타입이 아닙니다.
- `number`는 소장번호이며 문자열입니다. `007`을 `7`로 변환하지 않습니다.
- `review_status`: `pending | reviewed`. 미검수이면 `description=null`입니다.
- `description`: 7장의 공통 해설 객체 또는 null.
- `image_url`은 반환된 URL을 사용합니다. `/images/{filename}`은 JPEG·PNG·WebP 바이너리이며 없는 파일은 404입니다.

### GET /artworks

Query: `limit` 기본 20(1~100), `offset` 기본 0(0 이상).
성공 **200**: `{ "items": ArtworkDetail[], "total": number, "limit": number, "offset": number }`.
작품 ID 오름차순이며 비어 있으면 `items=[]`, `total=0`입니다. 오류 **422**.

### GET /artworks/{artwork_id}

Path: `artwork_id` string. 성공 **200**: `ArtworkDetail`. 오류 **404** 작품 없음.

### GET /artworks/by-number

| Query | 타입 | 필수 | 설명 |
|---|---|---|---|
| `number` | string, 1자 이상 | 필수 | 작품 번호. 정확히 일치하는 값 |
| `museum` | string, 1자 이상 | 선택 | 미술관명. 정확히 일치하는 값 |

예: `/artworks/by-number?number=007`. 한글·공백은 `URLSearchParams`로 인코딩합니다.
`museum` 미선택 시 빈 문자열 대신 파라미터를 생략합니다. 입력 앞뒤 공백은 FE에서 제거합니다.
성공 **200**: `ArtworkDetail`.
오류: **404** 해당 번호·미술관 조합 없음 / **409** 여러 미술관의 번호 중복, 미술관 지정 필요 / **422** 번호 누락·빈 값.
409 응답에는 미술관 후보 목록이 없으며 전용 미술관 목록 API도 없습니다.
404는 번호 조회 실패이며 촬영 이미지의 미등록 판정을 뜻하지 않습니다.

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

Bearer 인증, multipart:

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
  "quality": {
    "laplacian_variance": 150,
    "highlight_ratio": 0.05,
    "warnings": [],
    "note": "품질 경고는 규칙 기반 참고값이며 인식을 차단하지 않습니다."
  },
  "match_threshold": null
}
```

- `candidates`: 점수 내림차순 최대 3개. 비어 있을 수 있습니다. 작품 전체 정보는 상세 API로 조회합니다.
- 사진 `score_type=cosine_similarity`, 명패 `score_type=fuzzy_text_similarity`.
- 점수는 확률이 아니므로 정확도 %로 표시하지 않습니다. 사진 점수 범위 -1~1, 명패 점수 0~1입니다.
- `needs_confirmation`: FE에서 사용자가 후보 작품을 확인·선택하도록 합니다. 자동 확정 상태는 없습니다.
- `no_match`: 후보 없음. 사진 모드에서 임계값이 설정되고 최고 점수가 기준보다 낮아도 이 상태와 빈 후보를 반환합니다.
- `match_threshold`: 설정된 사진 임계값 또는 null. 명패는 항상 null. 평가 전 임의 기준값을 넣지 않습니다.
- `quality.warnings`: 흐림·반사 가능성 안내용 문자열 배열. 재촬영을 안내할 수 있으며 서버는 인식을 차단하지 않습니다.
- 미등록 해설을 원하면 FE가 촬영본을 다시 `/analyze`로 전송합니다. 이 API가 Gemini 해설까지 자동 생성하지 않습니다.

오류: 공통 이미지 오류, **401** 인증, **503** 작품·CLIP 의존성·모델·인덱스 미준비 또는 카탈로그와 인덱스 불일치.
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
  "mood_keywords": ["따뜻함"]
}
```

`facts`, `interpretations`, `mood_keywords`는 string 배열입니다. `regions`는 객체 배열이며 정확한 영역이 없으면 비어 있습니다.
`bbox=[왼쪽 x, 위쪽 y, 너비, 높이]`는 전체 이미지 대비 0~1 비율입니다. `[x1,y1,x2,y2]`가 아닙니다.
너비·높이는 양수이고 이미지 경계를 넘지 않습니다. 등록 작품은 원본, 실시간 분석은 회전 보정한 촬영본 기준입니다.
화면에 배치할 때 이미지의 실제 표시 영역·여백·줌 변환을 반영합니다.

### GET /artworks/{artwork_id}/narration

Bearer 인증. Path `artwork_id` 필수.
Query `mode`: `facts | interpretations | both`, 선택. 생략 시 계정 `/me/profile.narration_mode` 사용.
성공 **200**:

```json
{
  "artwork_id": "mona-lisa",
  "mode": "both",
  "segments": [
    {"type": "fact", "text": "붉은 형태가 있습니다."},
    {"type": "interpretation", "text": "가능한 감정적 해석입니다. 따뜻하게 느껴질 수 있습니다."}
  ],
  "text": "붉은 형태가 있습니다.\n가능한 감정적 해석입니다. 따뜻하게 느껴질 수 있습니다.",
  "review_status": "reviewed"
}
```

DB의 검수 해설만 읽으며 Gemini를 호출하지 않습니다. 음성 파일은 반환하지 않습니다.
`text` 또는 `segments`를 FE의 expo-speech로 재생합니다.
오류: **404** 작품 없음 / **409** 검수 해설 없음 / **422** 잘못된 mode.

### POST /analyze

Bearer 인증. multipart 필수 필드 `image`: 미등록 작품 사진. `mode`·작품명 입력 필드는 없습니다.
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

Bearer 인증. **현재 AI 함수가 없으므로 정상 입력도 503**입니다. 기존 앱 Skia 보정은 계속 사용할 수 있습니다.
multipart:

| Form | 타입 | 필수·규칙 |
|---|---|---|
| `artwork_id` | string | 등록 작품 원본을 사용할 때 전송 |
| `image` | 파일 | 미등록 촬영본을 사용할 때 전송. artwork_id와 정확히 하나만 전송 |
| `profile` | string | 선택. 4장의 AI 프로필 JSON을 `JSON.stringify()`한 문자열 |

`profile` 생략 시 계정에 저장된 AI 프로필을 사용하며 미설정이면 **409**입니다.
요청에 직접 넣은 profile은 이번 보정에만 적용하며 계정에 저장하지 않습니다.
연결 후 성공 **200**, `Content-Type: image/jpeg`, JPEG 바이너리이며 JSON이 아닙니다.
이미지는 회전·RGB 전처리 후 입력과 같은 크기이고 저장 URL을 발급하지 않습니다.

```ts
const body = new FormData();
body.append("artwork_id", "mona-lisa");
body.append("profile", JSON.stringify(aiProfile));
const response = await fetch(`${BASE_URL}/correction`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body,
});
if (!response.ok) {
  // 실패 응답은 JSON 오류로 처리
  throw new Error(`보정 실패: ${response.status}`);
}
const jpeg = await response.blob(); // 웹 예시. 네이티브는 앱의 이미지 로딩 방식에 맞춰 사용
```

오류: 공통 인증·이미지 오류, **404** 작품 없음 / **409** 프로필 미설정 /
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
사진 모드 `/recognize`는 이 AI 호출 제한을 사용하지 않습니다.
Gemini 외부 호출 동시 실행은 프로세스당 2개입니다. 제한은 단일 서버 프로세스 기준입니다.
FE는 자동 무한 재시도를 하지 않고 대기·수동 재시도를 제공합니다.

## 11. 화면 연결 순서

1. 회원가입 또는 로그인 → 토큰 저장 → `/me/profile`, `/me/ai-profile` 조회.
2. 앱 설정은 `/me/profile`, AI 보정 설정은 `/me/ai-profile`에 각각 저장.
3. 작품 번호 입력은 `/artworks/by-number`, 사진·명패는 `/recognize`로 조회.
4. 후보 선택 후 작품 ID로 상세·원본 조회 → `/narration` 텍스트를 TTS 재생.
5. `no_match`라면 촬영본으로 `/analyze` 호출 → 미검수·fallback 상태를 구분해 표시.
6. 등록 작품 감상 시 `/me/history` 등록. 미등록 감상 저장은 현재 지원하지 않음.
7. AI 보정 함수 연결 전까지 `/correction`의 503을 처리하고 앱 Skia 보정 사용.

개발 서버 실행 방법은 [Backend README](../Backend/README.md)를 참고합니다.
