# FE 전달 — 작품 조회·AI 프로필·보정·해설

전체 API의 요청·응답·인증·오류 규격은 [FE API 명세서](api-spec.md)를 참고합니다.

2026-11-03 기준, 이 문서와 함께 커밋한 백엔드 코드에 구현되어 있습니다. 배포 여부는 별도 확인이 필요합니다.

## 추가 필드

작품 목록의 `items`와 작품 상세 응답에 다음 필드가 포함됩니다.

```ts
number: string | null;
museum: string | null;
```

`number`는 작품 ID와 별개인 소장번호입니다. `007`, `INV 779`처럼 앞자리 0·문자가 있으므로 숫자로 변환하지 않습니다.
기존 작품에는 두 값이 `null`일 수 있습니다. 화면에서 해당 항목을 숨기거나 미등록으로 표시합니다.

## 번호 조회

```http
GET /artworks/by-number?number=007
```

미술관을 알고 있으면 함께 보냅니다. 공개 조회 API이므로 Bearer 토큰은 필요하지 않습니다.

```ts
const params = new URLSearchParams({ number: "INV 779", museum: "루브르 박물관" });
const response = await fetch(`${API_BASE_URL}/artworks/by-number?${params.toString()}`);
```

번호·미술관은 정확히 일치하는 값으로 조회합니다. 공백·대소문자 자동 보정이나 부분 검색은 하지 않습니다.
사용자가 입력한 번호의 앞뒤 공백은 FE에서 제거하고 빈 값은 전송 전에 안내합니다.
공백·한글·특수문자는 `URLSearchParams`로 인코딩합니다. 미술관을 선택하지 않았다면 `museum` 파라미터를 생략합니다.

성공 시 기존 `GET /artworks/{id}`와 동일한 상세 객체를 반환합니다. 아래는 데모 카탈로그를 등록한 경우의 응답 예시입니다.

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
  "image_url": "http://127.0.0.1:8000/images/<파일해시>.webp"
}
```

`image_url`은 서버가 반환한 URL을 그대로 사용합니다. 실기기에서는 FE가 접근할 수 있는 서버 주소를 사용해야 합니다.
미검수 해설은 `description: null`이며, 검수 완료 작품은 해설 JSON을 반환합니다.

## 상태 코드와 화면 처리

| 코드 | 의미 | FE 처리 |
|---|---|---|
| 200 | 한 작품 조회 성공 | 반환된 `id`를 기준으로 작품 상세·감상 화면 연결 |
| 404 | 해당 번호 또는 번호·미술관 조합 없음 | 번호·미술관 재확인 안내. 등록 작품으로 취급하지 않음 |
| 409 | 번호만으로는 여러 미술관의 작품이 조회됨 | 미술관 입력·선택 후 `museum`을 포함해 재요청 |
| 422 | 필수 `number` 누락 또는 빈 쿼리 값 | 입력값 확인 안내 |

404·409 응답은 `{ "detail": "안내 문구" }` 형식입니다. 422의 `detail`은 검증 오류 배열이므로 그대로 화면에 문자열로 출력하지 않습니다.
409 응답에는 후보 미술관 목록이 포함되지 않습니다. 미술관 전용 목록 API도 현재 없으므로 입력 UI 또는 앱에서 확보한 미술관 목록을 사용합니다.
404는 번호 조회 실패만 뜻하며, 촬영 이미지가 미등록 작품으로 판정됐다는 뜻은 아닙니다.

번호 조회 후 다른 API로 전달할 때는 번호가 아닌 작품 `id`를 사용합니다.
예: `GET /artworks/mona-lisa/narration`, `POST /me/history`의 `artwork_id: "mona-lisa"`.
해설·관람 기록 API는 로그인이 필요합니다.

## 로컬 확인

프로젝트 최상위에서 데모를 등록합니다.

```bash
./Backend/.venv/bin/python Backend/import_catalog.py Backend/catalog.demo.json
```

서버 실행 후 `/docs` 또는 다음 요청으로 확인합니다.

```bash
curl --get 'http://127.0.0.1:8000/artworks/by-number' \
  --data-urlencode 'number=INV 779' \
  --data-urlencode 'museum=루브르 박물관'
```

기존 DB에 번호 없는 데모를 등록했다면 위 등록 명령을 다시 실행해야 번호가 반영됩니다.

## AI 프로필 저장

`GET /me/ai-profile`, `PUT /me/ai-profile`은 로그인 필요입니다. 처음 조회하면 `null`이며 아직 설정하지 않았다는 뜻입니다.
PUT은 전체 저장이며 생략 필드는 아래 기본값으로 채웁니다. 기본값은 진단 결과가 아닌 사용자 설정 시작값입니다.

```json
{
  "color_type": "normal",
  "severity": 0,
  "contrast": 1,
  "brightness": 0,
  "sharpness": 0,
  "edge": 0
}
```

- `color_type`: `normal | protan | deutan | tritan`
- `severity`, `edge`: 0~1, `contrast`: 0.5~2, `brightness`: -50~50, `sharpness`: 0~2.
- 기존 `GET/PUT /me/profile`의 앱 설정과 독립적입니다. 이전 밝기(-1~1)를 자동 변환하지 않습니다.
- `POST /me/history`는 저장된 AI 프로필도 `ai_profile`로 스냅샷 저장합니다. 기존 기록·미설정 상태는 `null`입니다.

## 보정 이미지 API

`POST /correction`, Bearer 인증, multipart/form-data로 전송합니다.

| 필드 | 값 |
|---|---|
| `artwork_id` | 등록 작품 ID. 등록 원본으로 보정할 때 사용 |
| `image` | 미등록 촬영본 파일. `artwork_id`와 둘 중 하나만 전송 |
| `profile` | 선택. AI 프로필 JSON 문자열. 생략하면 계정의 저장된 AI 프로필 사용 |

성공 응답은 JSON이 아닌 `image/jpeg` 바이너리입니다. 촬영본은 EXIF 회전 보정 후의 입력 크기를 유지합니다.
등록 원본도 회전·RGB 전처리 후 보정 함수로 전달합니다. 촬영본·보정본은 영구 저장하지 않습니다.
직접 전달한 `profile`은 요청에만 적용하며 계정에 저장하지 않습니다.

```ts
const body = new FormData();
body.append("artwork_id", "mona-lisa");
const response = await fetch(`${API_BASE_URL}/correction`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body,
});
// Content-Type은 직접 지정하지 않아야 multipart boundary가 설정됩니다.
// 성공 시 JPEG 바이너리를 앱 이미지 로딩 방식에 맞게 사용합니다.
```

오류: `401` 로그인 필요, `404` 작품 없음, `409` AI 프로필 미설정,
`422` 입력 조합·프로필 오류, `413` 업로드 크기 초과, `415` 미지원 이미지,
`429` 호출 제한, `502` 보정 함수 출력 계약 오류, `503` AI 함수 미연결.
현재 AI의 `correct_image()` 구현은 없으므로 정상 입력도 **503**입니다. 기존 앱 Skia 보정은 계속 사용할 수 있습니다.

## CLIP 미등록 분기

`POST /recognize` 응답에 `match_threshold: number | null`을 추가했습니다.
서버에서 평가한 `CLIP_MATCH_THRESHOLD`를 설정하면 사진 모드의 최고 점수가 기준 미만일 때
`status: "no_match"`, `candidates: []`를 반환합니다. 기준 이상이면 `needs_confirmation`입니다.
기준이 없으면 기존 후보 확인 방식이며, 명패 모드에는 CLIP 기준을 적용하지 않습니다.
`no_match`이면 사용자에게 미등록 해설을 안내하고 촬영본으로 `/analyze`를 호출합니다.
이 호출은 FE가 명시적으로 수행하며 `/recognize`가 Gemini까지 자동 호출하지 않습니다.

## 해설 실패 표시

`POST /analyze` 응답에 `fallback: boolean`을 추가했습니다.
JSON 스키마 검증이 두 번 실패하면 HTTP 200으로 기본 안내와 `fallback: true`를 반환합니다.
이때 `description.facts`는 안내 문구이고 나머지 배열은 비어 있습니다. 작품 해설로 완료 표시하거나 저장하지 말고 재시도 안내로 보여주세요.
정상 생성은 `fallback: false`, 둘 다 `review_status: "unreviewed"`입니다.
API 키 미설정(503), 한도(429), 연결 오류(502), 시간 초과(504)는 별도 HTTP 오류로 처리합니다.
