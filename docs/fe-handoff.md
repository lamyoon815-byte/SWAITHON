# FE 전달 — 작품 번호·미술관 조회

2026-11-03 현재 로컬 백엔드 작업본에 구현되어 있습니다. 원격 푸시·배포 여부는 별도 확인이 필요합니다.

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
