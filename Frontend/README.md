# MoMi Frontend

저시력·색각이상 관람객을 위한 미술 감상 앱의 모바일 클라이언트입니다. FE 담당 2명이 같이 보는 작업 기준 문서입니다.
규칙을 바꾸고 싶으면 이 파일을 고치는 PR을 올리고 서로 확인한 뒤 머지합니다.

> 📌 `TODO` 표시가 있는 칸은 아직 정해지지 않았습니다. 정해지면 바로 채워 주세요.
> 실제 백엔드만 사용합니다. `EXPO_PUBLIC_API_URL`을 설정하고 백엔드를 먼저 실행하세요. 연결 실패 시 오류를 표시합니다.

---

## 1. 개요와 우선순위

| 항목 | 내용 |
|---|---|
| 앱 | Expo **SDK 58** (React Native 0.88, React 19.3), Expo Router, TypeScript strict |
| 실행 환경 | Expo Go (dev build 불필요, [4.1 검증 결과](../docs/tech-review.md#41-fe-담당자-확인-요청)). 단, 음성 검색 기능은 예외 (3장) |
| 와이어프레임 | [docs/wireframe/](docs/wireframe/) — 화면별 PNG 16장. `MoMi 와이어프레임.html`을 브라우저로 열면 한 번에 볼 수 있습니다. **화면 구성과 흐름**의 기준 |
| 디자인 | [docs/design/저시력 미술관 앱.html](docs/design/저시력%20미술관%20앱.html) — 홈 · 1-0 미술관 선택 · 카메라 · 작품 감상 · 마이페이지 · 하단 탭의 **최종 모양**. 브라우저로 열면 눌러 볼 수 있습니다. 와이어프레임과 다르면 디자인을 따릅니다 (9.1) |
| 메인 색상 | **차콜 `#33353B`** (라이트 모드 주 버튼) · **머스터드 `#E1AD21`** (선택·강조, 다크 모드 주 버튼) · **오프화이트 `#FAFAF7`** (라이트 배경) · **`#1C1D21`** (다크 배경) · 고대비 모드만 **노랑 `#FFD60A`**. 전체 토큰과 규칙은 [7장](#7-공통-ui-규칙) |
| BE API | [Backend/README.md](../Backend/README.md), 서버 실행 후 `http://<PC IP>:8000/docs` |
| 기획 근거 | [기술 검토 문서](../docs/tech-review.md), 예선 기획서 PDF |

범위는 [tech-review 5장](../docs/tech-review.md#5-구현-단계)과 와이어프레임 기준입니다. FE에 해당하는 것만 추렸습니다.

| 우선순위 | FE 작업 |
|---|---|
| **P0** (데모에 반드시 필요) | 로그인·회원가입 · 온보딩 + A/B 캘리브레이션 → 보정값 저장 · 작품 찾기(번호 입력, QR, 목록, 자동 촬영 인식) · 작품 감상(Skia 보정, 원본 전환, 강도 슬라이더, 핀치 줌) · 해설 재생(속도, 반복) · 마이페이지와 보정값 세부 조정 · 저시력 UI(큰 글씨, 고대비, 56dp 버튼) |
| **P1** (차별화) | 영역 터치 설명과 색 이름 안내(`regions`) · 해설 중 지금 설명하는 영역 표시 · 미등록 작품 일반 분석(4-2) · 학습 보정 모델 파라미터 적용 · 관람 기록 · 촬영 중 음성 위치 안내("조금 왼쪽으로") |
| **P2** (여유 있을 때) | 음성으로 작품·미술관 찾기 **기능** (버튼은 P0 화면에 넣어 둠) · 배경음악과 덕킹 |

와이어프레임 홈의 작품 찾기 우선순위는 **① 번호·QR → ② 음성 → ③ 목록 → ④ 촬영 인식** 입니다. 촬영 인식은 BE 인식 모델과 엮여 있어 마지막에 붙이고, 번호·QR·목록으로 먼저 데모가 끝까지 돌아가게 만듭니다.

---

## 2. 실행 방법

```bash
git clone https://github.com/lamyoon815-byte/SWAITHON.git MoMi
cd MoMi/Frontend
npm install          # package-lock.json이 있으므로 npm 사용
npx expo start
```

1. 휴대폰에 **Expo Go**를 설치합니다. 스토어의 Expo Go가 **SDK 58**을 지원해야 합니다. 앱을 열 때 SDK 버전이 맞지 않는다는 오류가 나오면 Expo Go를 업데이트합니다.
2. 터미널에 나온 QR을 찍습니다 (iOS는 기본 카메라 앱, Android는 Expo Go 안의 스캐너).
3. **QR을 찍어도 연결이 안 될 때** (학교·카페 와이파이, PC와 폰이 다른 네트워크): `npx expo start --tunnel`. 처음 실행하면 ngrok 패키지 설치를 물어보는데 `Y`를 누릅니다. 터널은 느리므로 같은 와이파이에서는 기본 모드를 씁니다.
4. 캐시 문제로 이상하게 동작하면 `npx expo start -c`.

**BE 서버에 붙일 때** ([Backend/README.md](../Backend/README.md)대로 서버를 띄운 뒤):

```bash
EXPO_PUBLIC_API_URL=http://<PC IP>:8000 npx expo start
```

- 폰에서 접속하므로 `localhost`가 아니라 PC의 IP를 씁니다. 서버도 `--host 0.0.0.0`으로 띄워야 폰에서 닿습니다.
- 작품이 없으면 BE의 `import_catalog.py catalog.demo.json`으로 모나리자 1점을 먼저 등록합니다.
- `--tunnel` 모드에서는 PC IP로 BE에 닿지 않을 수 있습니다. 이때는 BE도 공개 주소가 필요합니다.

**PR 올리기 전에 반드시**

```bash
npx expo lint
npx tsc --noEmit
```

패키지를 추가할 때는 `npm install` 대신 **`npx expo install <패키지>`** 를 씁니다 (SDK 58에 맞는 버전을 골라 줍니다). 네이티브 코드가 들어간 라이브러리는 Expo Go에서 안 돌아가므로 추가 전에 서로 상의합니다.

---

## 3. 스택 검증 표

기획서 6.1의 앱 기술 스택을 실기기에서 확인한 결과입니다. 상세 수치는 [fe-spike-checklist.md](docs/fe-spike-checklist.md)에 있습니다. 앱의 **마이페이지 → 기술 검증 (개발용)** 버튼으로 들어가 직접 다시 확인할 수 있습니다.

| 라이브러리 | 버전 | 용도 | iOS | Android | 판정 |
|---|---|---|---|---|---|
| expo-camera | ~58.0.12 | 작품·명패 촬영 | ✅ 촬영·리사이즈 | 미검증 | **검증 완료** (권한 팝업은 별도 빌드에서 재확인) |
| expo-camera (바코드) | ~58.0.12 | QR 스캔 (1-2) | 미검증 | 미검증 | 같은 패키지의 바코드 스캔 기능. 추가 설치 없음 |
| expo-speech | ~58.0.3 | 해설 TTS, 안내 문구 읽기 | ✅ 한국어 9개, 속도·반복 | 미검증 | **검증 완료** |
| @shopify/react-native-skia | 2.14.0 | 실시간 보정(색 행렬, 샤프닝) | ✅ 120fps | 미검증 | **변경 필요**: 기획서의 서버 보정(OpenCV)을 앱 보정으로 옮김 |
| react-native-gesture-handler | ~3.3.0 | 핀치 줌, 더블탭 | ✅ | 미검증 | **검증 완료** (v3 훅 API `usePinchGesture` 등 사용) |
| react-native-reanimated / worklets | 4.7.1 / 0.13.0 | 줌 애니메이션 | ✅ | 미검증 | **검증 완료** |
| @react-native-community/slider | 5.2.1 | 보정 강도, 대비·밝기·선명도 | ✅ | 미검증 | **검증 완료** |
| expo-image-manipulator | ~58.0.15 | 업로드 전 긴 변 1024px 리사이즈 | ✅ | 미검증 | **변경 필요**: `manipulateAsync`는 deprecated → `ImageManipulator.manipulate` 사용 |
| @react-native-async-storage/async-storage | 2.2.0 | 프로필·설정 기기 저장 | 미사용 | 미검증 | 설치만 됨. 온보딩 구현 때 검증 |
| expo-router (`expo-router/ui` Tabs) | ~58.0.26 | 화면 이동, 하단 탭 | ✅ | 미검증 | **검증 완료**. 디자인의 떠 있는 탭 바 때문에 NativeTabs 대신 `expo-router/ui`로 직접 그림 |
| expo-secure-store | 설치 필요 | 로그인 토큰 저장 | 미검증 | 미검증 | `npx expo install expo-secure-store`. Expo Go에 포함된 모듈 |
| expo-camera (자동 촬영) | ~58.0.12 | 셔터 없이 주기적으로 찍어 인식 (4) | 미검증 | 미검증 | **검증 필요**: Expo Go에서는 실시간 프레임 분석(frame processor)을 못 씀. 1~2초마다 저해상도로 `takePictureAsync` → `/recognize` 방식으로 확인. 셔터음, 발열, 배터리도 확인 |
| 음성 인식 (STT) | - | 음성으로 작품·미술관 찾기 (1, 1-0, 1-1) | - | - | **변경 필요**: expo-speech는 읽기(TTS)만 됨. 음성 인식은 Expo 기본 모듈에 없고 서드파티 네이티브 모듈이 필요해서 **Expo Go에서 안 됨** → 버튼만 화면에 두고 기능은 P2 |

**남은 검증**: Android 전체, QR 스캔, 자동 촬영 주기와 속도, 업로드 속도(BE 연결 후), 스크린리더 켠 상태에서 TTS와의 충돌(7장).

---

## 4. 폴더 구조와 네이밍

디자인의 하단 탭(**홈 · 카메라 · 마이**)에 맞춘 구조입니다. 탭 바는 화면 위에 떠 있으므로 탭 화면은 `useTabBarInset()`만큼 아래 여백을 둡니다. 1-0 미술관 선택, 로그인, 온보딩은 탭 바 없이 전체 화면으로 띄웁니다.
`✅`는 지금 있는 파일, 나머지는 만들 예정인 파일입니다.

```
Frontend/
├─ assets/images/
│  ├─ artworks/                 # 작품 이미지 리소스
│  └─ calibration/              # A/B 캘리브레이션 샘플 작품
├─ docs/
│  ├─ design/                   # ✅ 최종 디자인 HTML (저시력 미술관 앱.html)
│  ├─ wireframe/                # ✅ 와이어프레임 PNG + HTML
│  └─ fe-spike-checklist.md     # ✅
├─ src/
│  ├─ app/                      # 화면만. 파일 하나 = 라우트 하나
│  │  ├─ _layout.tsx            # ✅ 루트 Stack. TODO(A): 토큰 없으면 로그인, 프로필 없으면 온보딩으로 (공통 파일)
│  │  ├─ museum.tsx             # ✅ 1-0 미술관 선택 (전체 화면, `?next=number|list`)
│  │  ├─ capture.tsx            # ✅ 1-2 QR 스캔 (`?mode=qr`) + 4 작품 촬영 (`?mode=artwork`). 전체 화면, 항상 어두운 배경
│  │  ├─ spike.tsx, spike.web.tsx  # ✅ 기술 검증 (마이페이지의 개발용 버튼으로 들어감)
│  │  ├─ auth/
│  │  │  ├─ login.tsx           # 로그인 (와이어프레임 없음)
│  │  │  └─ register.tsx        # 회원가입 (와이어프레임 없음)
│  │  ├─ onboarding/
│  │  │  ├─ index.tsx           # 5   온보딩
│  │  │  ├─ calibration.tsx     # 6   A/B 선택 (5단계)
│  │  │  └─ result.tsx          # 6-1 내 보정값 확인
│  │  └─ (tabs)/
│  │     ├─ _layout.tsx         # ✅ 하단 탭 + 안내 토스트 (공통 파일)
│  │     ├─ (home)/
│  │     │  ├─ _layout.tsx      # ✅ 홈 탭 안의 Stack
│  │     │  ├─ index.tsx        # ✅ 1 홈 + 1-1 번호 입력 (디자인에서 합쳐짐)
│  │     │  ├─ not-found.tsx    # 1-3 작품을 찾지 못했어요
│  │     │  ├─ artwork/[id]/index.tsx      # ✅ 2 작품 감상 (1차: 정보 + 음성 해설 버튼)
│  │     │  ├─ artwork/[id]/narration.tsx  # 3 해설 재생
│  │     │  └─ analyze.tsx      # 4-2 이후 미등록 작품 일반 분석 (P1)
│  │     ├─ camera.tsx          # ✅ 카메라 탭: 찾는 방법 고르기 (QR 코드 스캔 / 작품 촬영) → capture.tsx
│  │     └─ mypage/
│  │        ├─ _layout.tsx      # ✅ 마이페이지 탭 안의 Stack
│  │        ├─ index.tsx        # ✅ 8 마이페이지 (지금은 미술관 기억 부분만)
│  │        ├─ correction.tsx   # 8-1 내 보정값 세부 조정
│  │        └─ history.tsx      # 7   관람 기록 (탭에서 빠져 마이페이지에서 들어감)
│  ├─ components/
│  │  ├─ app-tabs.tsx           # ✅ 떠 있는 하단 탭 바 (공통 파일)
│  │  ├─ common/                # 두 사람이 같이 쓰는 컴포넌트 (공통 파일)
│  │  │  ├─ big-button.tsx      # ✅ spike에서 옮김
│  │  │  ├─ back-button.tsx     # ✅ 왼쪽 위 둥근 뒤로 가기
│  │  │  ├─ artwork-card.tsx    # ✅ 번호 + 제목 + 작가 · 연도 + "보기" (1, 4-1, 7)
│  │  │  ├─ toast.tsx           # ✅ `showToast()` — 화면 아래 안내 + 스크린리더 낭독
│  │  │  ├─ app-bar.tsx         # 뒤로가기 + 제목 + 부제
│  │  │  └─ correction-canvas.tsx  # Skia 보정 + 줌 (2, 3, 6, 6-1, 8-1)
│  │  ├─ home/museum-card.tsx   # ✅ 홈의 "현재 미술관" 카드
│  │  ├─ <화면명>/              # 해당 화면에서만 쓰는 컴포넌트 (예: components/home/)
│  │  └─ spike/                 # 기술 검증용. 필요한 것만 common으로 옮기고 나머지는 지운다
│  ├─ constants/
│  │  ├─ theme.ts               # ✅ 간격, 폰트 패밀리 (공통 파일)
│  │  └─ a11y.ts                # ✅ 색 팔레트, 글씨 크기, 최소 터치 영역 (공통 파일)
│  ├─ hooks/                    # use-*.ts
│  │  ├─ use-settings.ts        # ✅ 기기 설정 (현재 미술관 등) 읽기·쓰기
│  │  ├─ use-resource.ts        # ✅ api.ts 결과를 화면에서 받는 작은 훅
│  │  └─ use-tab-bar-inset.ts   # ✅ 떠 있는 탭 바만큼 아래 여백
│  ├─ lib/
│  │  ├─ api.ts                 # 실제 BE 호출만 사용 (공통 파일)
│  │  └─ color-matrix.ts, sharpen.ts, resize.ts   # ✅ 스파이크에서 만든 순수 함수
│  ├─ store/                    # 기기 저장 (✅ settings.ts: AsyncStorage, auth.ts: SecureStore 토큰, profile.ts)
│  └─ types/                    # ✅ artwork.ts, museum.ts (공통 파일)
```

**네이밍**

- 파일명은 **kebab-case** (`big-button.tsx`, `use-profile.ts`). 기존 코드와 같습니다.
- 컴포넌트와 타입은 PascalCase, 함수와 변수는 camelCase. 단 BE에서 받은 객체의 필드는 snake_case 그대로 씁니다 (6장).
- 컴포넌트는 named export (`export function BigButton`), 라우트 파일만 `export default`.
- import는 `@/` 경로 별칭을 씁니다 (`@/constants/a11y`). 상대 경로 `../../`는 쓰지 않습니다.
- `src/app/` 안에는 화면 파일만 둡니다. 컴포넌트·훅·유틸을 넣으면 라우트로 잡힙니다.
- 화면 파일 첫 줄 주석에 와이어프레임 번호를 적습니다 (`// 와이어프레임 1-1 번호 입력`).
- 템플릿에서 온 화면과 컴포넌트는 지웠습니다. `animated-icon`(스플래시)만 남아 있습니다.

---

## 5. 화면

### 5.1 화면 소유권

**각자 자기 화면 파일과 `components/<화면명>/`만 고칩니다.** 그러면 충돌이 거의 나지 않습니다. 남의 화면을 고쳐야 하면 먼저 말하고, 가능하면 담당자에게 맡깁니다.

- **담당 A** = 박지현: 로그인·회원가입 · 온보딩·캘리브레이션·보정값 · 마이페이지 · 작품을 찾지 못했어요(1-3) · 관람 기록
- **담당 B** = 김규린: 하단 탭 · 홈과 미술관 선택(번호 입력 포함) · 카메라(QR, 촬영 인식) · 작품 감상·해설

홈과 미술관 선택은 처음에 A였는데 B로 옮겼습니다. 카메라에서 작품을 인식하면 그 미술관이 현재 미술관이 되므로, "현재 미술관"을 쓰는 화면(홈 카드, 1-0, 카메라)을 한 사람이 맡는 게 충돌이 적습니다. 디자인에서 번호 입력(1-1)이 홈에 합쳐져서 같이 옮겼습니다.

| 와이어프레임 | 화면 | 파일 (`src/app/` 기준) | 우선순위 | 담당 | 상태 |
|---|---|---|---|---|---|
| - | 로그인 | `auth/login.tsx` | P0 | A | 실제 인증 API 연결 |
| - | 회원가입 | `auth/register.tsx` | P0 | A | 실제 인증 API 연결 |
| 5 | 온보딩 | `onboarding/index.tsx` | P0 | A | 구현 |
| 6 | 보기 설정 테스트 | `onboarding/index.tsx` | P0 | A | AI 합의 규칙 반영 |
| 6-1 | 내 보정값 확인 | `onboarding/index.tsx` | P0 | A | 결과 확인·기기 저장 구현 |
| 1-3 | 작품을 찾지 못했어요 | `(tabs)/(home)/not-found.tsx` | P0 | A | 시작 전 |
| 8 | 마이페이지 | `(tabs)/mypage/index.tsx` | P0 | A | 계정·보기 설정·로그아웃 연결 |
| 8-1 | 내 보정값 세부 조정 | `correction.tsx` | P0 | A | 구현 |
| 7 | 관람 기록 | `(tabs)/mypage/history.tsx` | P1 | A | 시작 전 |
| - | 하단 탭, 루트 레이아웃 | `_layout.tsx`, `(tabs)/_layout.tsx`, `components/app-tabs.tsx` | P0 | B | 진행 중 (디자인 반영, 로그인 분기는 A) |
| 1 / 1-1 | 홈 (작품 선택 + 번호 입력) | `(tabs)/(home)/index.tsx` | P0 | B | 실제 BE 데이터 연결 |
| 1-0 | 미술관 선택 | `museum.tsx` | P0 | B | 실제 BE 데이터 연결 |
| - | 카메라 탭: 찾는 방법 고르기 | `(tabs)/camera.tsx` | P0 | B | 진행 중 |
| 1-2 / 4 / 4-1 / 4-2 | QR 스캔 + 작품 촬영 인식 (높음·중간·낮음) | `capture.tsx` | P0 | B | 실제 BE 연결, 지현님 촬영·실패 화면 흐름 우선 |
| 2 | 작품 감상 | `(tabs)/(home)/artwork/[id]/index.tsx` | P0 | B | 저장된 보기 설정·서버 색/윤곽선·Skia 연결 |
| 3 | 해설 재생 | `(tabs)/(home)/artwork/[id]/narration.tsx` | P0 | B | 시작 전 |
| 4-2 이후 | 미등록 작품 일반 분석 | `(tabs)/(home)/analyze.tsx` | P1 | B | 시작 전 |
| - | Spike (기술 검증) | `spike.tsx` | - | - | 마이페이지 개발용 버튼으로 들어감. 필요한 것 옮긴 뒤 제거 |

상태 값: `시작 전` / `진행 중` / `PR 올림` / `완료`. 상태가 바뀌면 이 표를 같이 고칩니다.

**공통 컴포넌트 담당**: `correction-canvas.tsx`(Skia 보정 + 줌)는 B가 만들었고, A는 6·6-1·8-1에서 가져다 씁니다. `big-button`, `back-button`, `artwork-card`, `toast`도 B가 만들어 두었습니다. `app-bar`는 A가 만듭니다.

`CorrectionCanvas` 사용법 — 보정값은 BE 시각 프로필(`src/types/profile.ts`)을 그대로 넘기고, 슬라이더·토글은 각 화면이 만듭니다.

```tsx
<CorrectionCanvas
  source={artwork.image_url}            // 서버 URL 또는 require('@/assets/…')
  accessibilityLabel="별이 빛나는 밤, 빈센트 반 고흐"
  correction={profile}                  // contrast · brightness · sharpen · strength
  original={false}                      // true면 보정 없이 원본
  zoomable                              // 핀치·더블탭 + 확대/축소 버튼. 캘리브레이션 비교에서는 생략
  palette={palette}
  style={{ height: 240 }}               // 상자 크기 (기본 높이 320)
/>
```

**작업 순서**: 탭·루트 레이아웃·홈 흐름이 머지되면 A는 로그인·온보딩·마이페이지를, B는 보정 캔버스와 작품 감상·해설을 이어서 합니다.

### 5.2 화면 이동

| 출발 | 조건 / 동작 | 도착 |
|---|---|---|
| 앱 실행 | 저장된 토큰 없음 / 만료 (401) | 로그인 |
| 로그인 | 회원가입 | 회원가입 |
| 로그인 · 회원가입 | 성공 | 기기에 저장한 보기 설정 없음: 온보딩 / 있음: 홈 |
| 앱 실행 | 토큰 있음 | 위와 같이 온보딩 또는 1 홈 |
| 8 마이페이지 | 로그아웃 | 로그인 (`POST /auth/logout` 후 토큰 삭제) |
| 5 온보딩 | 시작하기 | 색 구분 확인 → 보정 종류 선택 → 색 보정 세기 → 선 굵기 → 대비 → 저장 |
| 5 온보딩 | 건너뛰고 바로 보기 | 1 홈 (기본 보정값 저장) |
| 6 캘리브레이션 | 5단계 끝 / 건너뛰기 | 6-1 내 보정값 확인 |
| 6-1 내 보정값 확인 | 이 값으로 시작하기 | 1 홈 (`router.replace`, 뒤로 가기로 온보딩에 돌아가지 않게) |
| 6-1 내 보정값 확인 | 다시 진단하기 | 6 캘리브레이션 (1단계부터) |
| 1 홈 | 현재 미술관 카드의 "변경" / 빈 카드의 "선택하기" | 1-0 미술관 선택 |
| 1 홈 | 번호 입력칸 누름 — 미술관 없음 | 1-0 미술관 선택 (`?next=number`) → 고르면 홈으로 돌아와 입력칸에 바로 커서 |
| 1 홈 | 번호 입력 — 미술관 있음 | 같은 화면에서 목록이 바로 걸러짐 ("1" → 01, 11, 12…). 완료를 누르면 맞는 번호의 2 작품 감상, 없으면 "찾는 작품이 없어요" |
| 1 홈 | 목록 자리의 "미술관 선택하기" | 1-0 미술관 선택 (`?next=list`) → 고르면 홈 목록 |
| 1-0 미술관 선택 | 미술관 누름 | 기기에 기억(`recent_museum_id`)하고 홈으로. 다음 실행 때도 카드에 표시 |
| 1 홈 | 작품 목록에서 누름 | 2 작품 감상 |
| 카메라 탭 | QR 코드 스캔 / 작품 촬영 (처음이면 카메라 권한 요청) | 촬영 화면 `capture?mode=qr` / `capture?mode=artwork` (탭 바 없음) |
| 촬영 화면 (두 모드 모두) | QR 인식 성공 (자동) | 그 작품의 미술관이 현재 미술관이 되고 2 작품 감상 (촬영 화면은 뒤로 가기에서 빠짐, "작품을 찾았어요" 안내) |
| 촬영 화면 | QR 인식 — 없는 작품 | 지금: "등록되지 않은 QR 코드예요" 안내. 1-3이 생기면 1-3 작품을 찾지 못했어요 |
| 촬영 화면 (작품) | 촬영 | 촬영·리사이즈 후 `/recognize/artwork` 호출. 서버의 next_action에 따라 이동·후보 확인·분석·재촬영 |
| 촬영 화면 (QR) | 번호로 찾기 | 1 홈 입력칸 |
| 1-3 작품을 찾지 못했어요 | 번호 다시 입력 / 카메라로 다시 찾기 / 목록에서 고르기 | 1 홈 입력칸 / 카메라 탭 / 1 홈의 목록 |
| 1 홈 | 음성 버튼 | 기능 구현 전: "음성으로 찾기는 준비 중이에요" 안내만 (화면 이동 없음) |
| 8 마이페이지 | 미술관 기억 지우기 | 현재 미술관을 비움 → 홈이 빈 카드로 |
| 4 촬영 인식 | 신뢰도 높음 | 2 작품 감상 (`router.replace`) |
| 4 촬영 인식 | 신뢰도 중간 → 4-1 확인 시트 | 예, 맞아요 → 2 작품 감상 / 아니요 → 4 다시 촬영 |
| 4 촬영 인식 | 신뢰도 낮음 → 4-2 미등록 시트 | 일반 분석 듣기 → 미등록 분석 / 다시 촬영하기 → 4 / 번호로 찾기 → 1 홈 입력칸 |
| 4 촬영 인식 | 번호로 찾기 | 1 홈 입력칸 |
| 2 작품 감상 | 해설 듣기 | 3 해설 재생 |
| 2 작품 감상 | 진입 시 | 관람 기록 저장 (P1, `POST /me/history`) |
| 8 마이페이지 | 관람 기록 | 7 관람 기록 |
| 7 관람 기록 | 기록 누름 | 2 작품 감상 (그때 보정값으로) |
| 8 마이페이지 | 내 보정값 | 8-1 내 보정값 세부 조정 |
| 8-1 세부 조정 | 보정값 다시 맞추기 | 6 캘리브레이션 |
| 8-1 세부 조정 | 저장하기 / 변경 취소 | 8 마이페이지 |

- 라우트 이동은 `expo-router`의 `router.push / replace`와 `<Link>`를 씁니다.
- 화면 사이에는 **작품 id만** 파라미터로 넘기고(`useLocalSearchParams`), 나머지는 각 화면에서 다시 읽습니다. 촬영 이미지 URI처럼 큰 값은 파라미터로 넘기지 않습니다.
- 관람 기록에서 들어온 경우는 `?history=<기록 id>`를 같이 넘겨, 감상 화면이 그때 보정값을 쓰게 합니다.
- 각 와이어프레임 아래쪽의 **"결과 미리보기"** 버튼(있는 번호/없는 번호, 높음/중간/낮음 등)은 와이어프레임에서 상태를 보여주려는 것입니다. 앱에는 넣지 않습니다.

---

## 6. 데이터 규칙

BE가 이미 구현되어 있으므로 **필드 이름과 값 범위는 BE 응답을 그대로 따릅니다** (snake_case 포함). 화면에서 camelCase로 바꾸지 않습니다. 타입은 `src/types/`에 BE 모델과 같은 모양으로 둡니다.
BE 모델이 바뀌면 [Backend/catalog.py](../Backend/catalog.py), [Backend/accounts.py](../Backend/accounts.py), [Backend/ai_routes.py](../Backend/ai_routes.py)를 확인하고 타입을 같이 고칩니다.

### 6.1 작품 (`src/types/artwork.ts`)

`GET /artworks/{id}` 응답 (BE `ArtworkDetail`). `GET /artworks`는 `{ items: Artwork[], total, limit, offset }`.

```ts
export type Region = {
  label: string;                          // "붉은 꽃"
  bbox: [number, number, number, number]; // [x, y, width, height], 원본 이미지 대비 0~1, 왼쪽 위 기준
  color: string;                          // "붉은색" (색 이름 안내용)
};

export type Description = {
  facts: string[];            // 객관적 시각 정보 (인물, 사물, 색채, 구도)
  interpretations: string[];  // 시각적 단서에 근거한 분위기와 감정 해설
  regions: Region[];          // 영역 터치, 위치 안내
  mood_keywords: string[];    // 배경음악 추천 (P2)
  fact_region_indices: (number | null)[] | null;
  interpretation_region_indices: (number | null)[] | null;
  narration_order?: { type: 'fact' | 'interpretation'; index: number }[] | null;
};

export type Artwork = {
  id: string;                 // "mona-lisa" (소문자, 숫자, -, _)
  title: string;
  artist: string;
  year: string | null;
  number: string | null;
  museum_id: string | null;
  museum: string | null;
  background: string | null;  // 제작 배경
  source_url: string | null;  // 원본 출처 페이지 (저작권 표시용)
  license: string | null;
  description: Description | null;      // 사람이 검수하기 전에는 null
  review_status: 'pending' | 'reviewed';
  image_url: string;          // 고화질 원본. 보정·줌 대상
};
```

- `description`이 `null`이면 "아직 해설이 준비되지 않았어요"를 보여주고 해설 버튼을 비활성화합니다 (데모용 모나리자도 현재 `null`).
- 사실(`facts`)과 해석(`interpretations`) 분류는 유지합니다. '둘 다 듣기'는 서버의 `segments` 순서대로 관찰과 감상이 자연스럽게 이어지며, 유형별로 다시 묶지 않습니다.
- **썸네일은 따로 없습니다.** 목록에서도 `image_url`을 `expo-image`로 작게 띄웁니다. 느리면 BE에 썸네일을 요청합니다.
- 작품 번호·미술관 ID는 BE에 반영됐습니다. FE API 연결 시 `number`, `museum_id`, `museum`의 null을 처리합니다. 번호는 문자열로 유지하며 숫자로 바꾸지 않습니다.
- 작품·미술관·이미지는 실제 BE 카탈로그에서 가져옵니다. 임시 데이터 대체는 사용하지 않습니다.

### 6.2 해설

`GET /artworks/{id}/narration?mode=facts|interpretations|both` (로그인 필요)

```ts
export type Narration = {
  artwork_id: string;
  mode: 'facts' | 'interpretations' | 'both';
  segments: { type: 'fact' | 'interpretation'; text: string; region_index: number | null }[];
  text: string;               // segments를 줄바꿈으로 합친 것
  review_status: 'reviewed';
};
```

- 해설 재생(3)은 `segments`를 **한 문장씩** `expo-speech`로 읽습니다. 그래야 반복, 진행 바, 지금 읽는 문장 표시를 할 수 있습니다.
- 해석 문장도 별도 안내 문구 없이 `text`를 그대로 표시·재생합니다. 사실·해석 구분에는 `type`을 사용합니다.
- AI는 하나의 완성된 대본을 쓴 뒤 `facts`·`interpretations`로 분류하고 `narration_order`에 낭독 순서를 기록합니다. 서버가 이 순서를 `segments`로 변환하므로 FE에서 배열을 다시 합치지 않습니다. 사실만·해석만 듣기는 이 순서를 유지하며 `type`으로 필터합니다.
- 1분용은 전체 대본 300~350자를 점검해 필요하면 한 번 고쳐 쓰고, 3분용은 주제 안에서 사실·감상이 이어지는 섹션 순서와 필수 내용을 유지합니다. 단독 모드의 재생 시간은 남은 문장 수에 따라 짧아질 수 있습니다.
- 미등록 작품 `/analyze` 응답도 `segments`를 제공하므로 동일한 낭독 순서를 사용합니다.
- "지금 설명하는 영역"은 `region_index`로 작품 상세 `description.regions`를 참조합니다(0부터). null은 강조하지 않습니다. 기존 해설은 연결 검수 전까지 null입니다.
- 해설이 없으면 409가 옵니다.

### 6.3 촬영 인식

`POST /recognize/artwork` 또는 `/recognize/placard` (로그인 불필요) — multipart `image`(긴 변 1024px JPEG). 응답의 `next_action`으로 분기하며 `message`를 안내합니다.

```ts
export type RecognitionResult = {
  mode: 'artwork' | 'placard';
  candidates: { artwork_id: string; title: string; artist: string; score: number; image_url: string }[]; // 최대 3개
  score_type: 'cosine_similarity' | 'fuzzy_text_similarity';
  status: 'matched' | 'needs_confirmation' | 'no_match';
  confidence: 'high' | 'medium' | 'low';
  match_threshold: number | null;
  quality: {
    laplacian_variance: number; highlight_ratio: number; warnings: string[]; note: string;
    artwork_bbox: [number, number, number, number] | null; // 회전 보정 촬영본의 xywh 비율
    framing_hint: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'move_closer' | 'move_back' | 'hold_still' | null;
  };
};
```

- `confidence`가 high면 바로 작품으로 이동, medium이면 4-1 확인 시트, low면 4-2 미등록 안내입니다. **FE에서 점수로 기준을 만들지 않습니다.**
- 실제 촬영 평가 기준이 없으면 BE는 후보를 medium으로 반환합니다. high 기준은 평가 후 서버 환경변수로 설정합니다.
- `score`는 확률이 아닙니다. 화면에 퍼센트로 보여주지 않습니다.
- `quality.warnings`가 있으면(흐림, 반사) 재촬영 안내 문구로 씁니다.

**자동 촬영 (4)**

- 셔터 버튼 없이, 화면에 들어오면 **1~2초 간격**으로 저해상도 사진을 찍어 1024px로 줄인 뒤 `/recognize`에 보냅니다. 간격은 실기기에서 정합니다.
- 요청이 끝나기 전에는 다음 촬영을 하지 않습니다 (한 번에 요청 하나).
- `confidence`가 `high`이거나 후보가 나오면 촬영을 멈추고 결과로 넘어갑니다. `quality.warnings`만 있으면 안내 문구를 바꾸고 계속 찍습니다.
- **일정 시간(예: 15초) 안에 못 찾으면** 멈추고 4-2 시트를 띄웁니다. 계속 찍으면 배터리와 서버 요청이 낭비됩니다.
- 화면을 떠나거나 앱이 백그라운드로 가면 촬영을 반드시 멈춥니다.
- 위치 안내는 `quality.framing_hint`가 있을 때 사용합니다. move_left는 카메라를 왼쪽으로 이동하라는 뜻입니다. bbox·힌트가 null이면 고정 문구("화면 안에 작품이 가득 차게 맞춰 주세요")를 사용합니다.
- 자동 반복은 artwork 모드만 사용합니다. 사진은 60회/60초이며 혼잡 시 503 + Retry-After: 2, 한도 초과 시 429 + Retry-After: 60입니다. 해당 초만큼 기다린 뒤 재개합니다. 명패는 기존 공유 5회/분 제한을 유지합니다.
- 미등록 작품은 `POST /analyze` (multipart `image`) → `{ description, review_status: 'unreviewed', warning }`. `warning` 문구를 화면과 음성으로 반드시 알립니다.

### 6.4 시각 프로필

BE 모델 (`GET/PUT /me/profile`, 로그인 필요):

```ts
export type VisualProfile = {
  color_vision: 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  color_severity: number;   // 0~1
  strength: number;         // 0~1   보정 강도 (화면 표시: 0~100%)
  contrast: number;         // 0.5~2 기본 1 (화면 표시: (값-1)×100 → -50~+100)
  brightness: number;       // -1~1  기본 0 (화면 표시: 값×100 → -100~+100)
  sharpen: number;          // 0~2   기본 0 (화면 표시: 값×100 → 0~+200)
  zoom: number;             // 1~8   기본 1
  narration_mode: 'facts' | 'interpretations' | 'both';
  speech_rate: number;      // 0.75~1.5
  high_contrast: boolean;
};
```

- 와이어프레임의 `대비 +30`, `밝기 +10`, `선명도 +20`, `보정 70%` 같은 숫자는 위 괄호의 변환 규칙으로 표시합니다. 변환 함수는 `src/lib/profile-format.ts` 한 곳에 둡니다.
- `PUT /me/profile`은 **전체 교체**입니다. 받은 프로필을 고친 뒤 전부 보냅니다. 빠진 필드는 기본값으로 덮입니다.
- 마이페이지의 "색각 유형: 선택 안 함"은 BE에 해당 값이 없습니다. 지금은 `normal`로 저장합니다.

**BE에 없는 기기 설정** (와이어프레임에는 있음). 기기에만 저장합니다:

```ts
export type DeviceSettings = {
  color_name_guide: boolean;   // 색 이름 안내 (6-1, 8-1)
  music_autoplay: boolean;     // 배경 음악 자동 재생 (8)
  font_scale: 'normal' | 'large' | 'xlarge'; // 글씨 크기 (8). 시스템 글꼴 배율에 곱함
  recent_museum_id: string | null;           // 최근 방문 미술관 (1-0)
};
```

**저장 위치**

- AsyncStorage 키: `swaithon:profile:v1`(VisualProfile), `swaithon:settings:v1`(DeviceSettings). 모양이 바뀌면 버전을 올리고 이전 값을 변환하는 코드를 같이 넣습니다.
- 읽기/쓰기는 `src/store/`에서만 합니다. 화면에서 `AsyncStorage`나 프로필 API를 직접 부르지 않고 `use-profile` 훅을 씁니다.
- **서버(`/me/profile`)가 원본**이고 AsyncStorage는 캐시입니다. 앱 시작 시 캐시로 먼저 그리고, 서버 값을 받아 덮어씁니다. 저장은 서버에 `PUT` 성공한 뒤 캐시를 고칩니다.
- `DeviceSettings`는 서버에 없으므로 기기에만 저장합니다. 다른 폰으로 로그인하면 초기값입니다.
- 로그아웃하면 프로필 캐시와 토큰을 지웁니다. `DeviceSettings`(글씨 크기 등)는 남겨 둡니다.

**로그인 토큰**

- `POST /auth/login`, `/auth/register` 응답의 `access_token`을 **`expo-secure-store`** 에 저장합니다 (AsyncStorage 금지, BE README 권장). 키: `swaithon.session.v1`.
- 요청 헤더: `Authorization: Bearer <token>`. 붙이는 것은 `api.ts`가 합니다.
- 세션은 **7일**이면 만료됩니다. 401이 오면 토큰을 지우고 로그인 화면으로 보냅니다.
- 비밀번호는 8~128자, 닉네임은 1~40자 (BE 검증과 같게 화면에서도 미리 알려 줍니다).
- 로그인 응답의 `user`(`id`, `email`, `nickname`)를 마이페이지(8)의 이름·이메일에 씁니다.

### 6.5 API 공통

- 주소는 **`EXPO_PUBLIC_API_URL`** 에서 읽고, 호출은 `src/lib/api.ts` 한 곳에 모읍니다. 주소를 코드에 하드코딩하지 않습니다.
- 스파이크의 `EXPO_PUBLIC_UPLOAD_URL`은 본 구현에서 `EXPO_PUBLIC_API_URL`로 합칩니다.
- API 키(Gemini 등)는 **앱에 절대 넣지 않습니다.** `EXPO_PUBLIC_` 변수는 앱 번들에 그대로 들어갑니다.
- `EXPO_PUBLIC_API_URL`은 필수입니다. 주소가 없거나 서버가 꺼져 있으면 오류를 표시하며 임시 데이터를 반환하지 않습니다.
- 오류 처리: 401 → 토큰 삭제 후 로그인 화면, 404 → 1-3 작품을 찾지 못했어요, 409 → 해설 준비 중, 429 → "잠시 후 다시 시도해 주세요", 503 → "지금은 이 기능을 쓸 수 없어요". 오류 문구도 화면과 음성으로 같이 알립니다.

| 메서드 | 경로 | 로그인 | 쓰는 화면 |
|---|---|---|---|
| GET | `/artworks?limit&offset` | | 1 홈 목록 |
| GET | `/artworks/{id}` | | 2, 3, 4-1 |
| GET | `/artworks/{id}/narration` | 필요 | 3 해설 재생 |
| POST | `/recognize/artwork` | 불필요 | 4 촬영 인식 |
| POST | `/analyze` | 필요 | 미등록 작품 (P1) |
| GET / PUT | `/me/profile` | 필요 | 6-1, 8, 8-1 |
| GET / POST / DELETE | `/me/history` | 필요 | 2(기록 저장), 7 |
| POST | `/auth/register`, `/auth/login` | | 로그인, 회원가입 |
| POST | `/auth/logout` · GET `/me` | 필요 | 8 마이페이지 |
| GET | `/museums`, `/artworks?museum_id=...`, `/artworks/by-number?museum_id=...&number=...` | | 1-0, 1-1. QR은 `momi://artwork/<id>`에서 ID 추출 후 상세 조회. FE 연결은 별도 |

---

## 7. 공통 UI 규칙

저시력·색각이상 사용자가 주 사용자입니다. 아래는 리뷰에서 반드시 확인합니다.

**메인 색: 차콜 + 머스타드, 오프화이트 배경** ([비교 페이지](https://claude.ai/artifact/RyPWjAfVj1PceU1p9zYtAY))

| 토큰 | 라이트 | 다크 | 고대비 | 쓰는 곳 |
|---|---|---|---|---|
| `background` | `#FAFAF7` 오프화이트 | `#1C1D21` | `#000000` | 화면 배경 |
| `surface` | `#FFFFFF` 화이트 | `#2A2C31` | `#000000` | 카드, 입력칸, 보조 버튼 채움 |
| `text` | `#26282D` | `#EDEDEF` | `#FFFFFF` | 본문 |
| `textSecondary` | `#4B4E55` (7.6:1 이상) | `#B4B8C0` | `#FFFFFF` | 부제, 작가명 |
| `accent` / `accentText` | `#33353B` / 흰색 (12.3:1) | `#E1AD21` / `#1C1D21` (8.2:1) | `#FFD60A` / 검정 | 주 버튼 (작품 보기, 시작하기) |
| `highlight` / `highlightText` | `#E1AD21` / `#26282D` (7.2:1) | `#E1AD21` / `#1C1D21` (8.2:1) | `#FFD60A` / 검정 | 선택된 탭, 선택한 항목, "최근 방문" 배지 |
| `border` | `#33353B` | `#8A8F99` | `#FFFFFF` | 카드·버튼 테두리 |

- 순검정 대신 **차콜**, 순백 대신 **거의 무채색인 오프화이트**를 씁니다. 대비는 모두 AAA(7:1) 이상입니다.
- 오프화이트를 더 노랗게(크림색) 바꾸지 않습니다. 작품 색이 그쪽으로 보입니다.
- 고대비 모드만 순검정 + 밝은 노랑 `#FFD60A`입니다. 머스타드보다 검정 위에서 더 잘 보입니다.
- **라이트 모드에서 머스타드는 채움으로만** 씁니다. 배경 위 머스타드는 약 2:1이라 머스타드 글자나 머스타드 테두리만 있는 요소는 잘 안 보입니다. 머스타드를 칠한 위에는 차콜 글자를 올립니다.
- 머스타드보다 어두운 오커는 쓰지 않습니다. 차콜 글자와의 대비가 7:1 아래로 떨어집니다.
- 작품 이미지 주변(감상 화면 배경, 이미지 테두리)에는 머스타드를 깔지 않습니다.

**디자인 HTML의 색과 대응** ([docs/design/](docs/design/)은 검정 배경 + `#FFB800` 한 벌만 있습니다. 코드에서는 아래 토큰으로 바꿔 씁니다)

| 디자인 | 토큰 | 예 |
|---|---|---|
| `#FFB800` 채운 카드·알약 | `highlight` 위에 `highlightText` | 현재 미술관 카드, 선택된 하단 탭, 안내 토스트 |
| `#FFB800` 주 버튼 ("보기", "선택하기") | `accent` 위에 `accentText` | 다크는 머스터드, 라이트는 차콜로 바뀝니다 |
| `#FFB800` 글자 (작품 메타 등) | 다크: `highlight` / 라이트: `text` | 라이트에서 머스터드 글자는 안 보여서 본문 색으로 |
| `#0b0b0c` 배경 · `#1c1c1e` 카드 | `background` · `surface` | |
| `#2c2c2e` 보조 버튼 · 번호 칸 | `Colors[scheme].backgroundSelected` | 음성 버튼, 뒤로 버튼, 작품 번호 칸 |
| `#9a9a9f` 보조 글자 | `textSecondary` | 작가명, 개수 |

**색과 글씨**
- 색은 `src/constants/a11y.ts`의 `getPalette(scheme, highContrast)`로만 가져옵니다. 화면에 `#xxxxxx`를 직접 쓰지 않습니다.
- 글씨 크기는 `FontSize` 토큰(본문 20, 라벨 18, 제목 26, 버튼 22)을 씁니다. 이보다 작은 글씨는 쓰지 않습니다.
- `allowFontScaling`을 끄지 않습니다. 시스템 글꼴을 최대로 키워도 글자와 버튼이 잘리지 않는지 확인합니다 (고정 `height` 대신 `minHeight`).
- 와이어프레임은 흑백이지만 **고대비 모드(검정/흰색/노랑)와 일반 모드 둘 다** 모든 화면을 한 번씩 확인합니다.

**버튼과 터치**
- 터치 영역은 **`MinTouchTarget`(56dp) 이상**. 번호 키패드 키는 와이어프레임대로 68 이상. 작은 아이콘도 `hitSlop`이 아니라 실제 크기를 56 이상으로 합니다.
- 화면의 주요 동작은 와이어프레임처럼 **하단 큰 버튼**으로 둡니다. 채워진 검정 버튼이 주 동작, 테두리 버튼이 보조, 점선 버튼이 우선순위 낮은 동작입니다.
- 제스처(핀치, 스와이프, 더블탭)만으로 되는 기능은 만들지 않습니다. 같은 동작을 하는 버튼을 항상 같이 둡니다 (스크린리더를 켜면 핀치가 막힘). "핀치로 확대" 배지 옆에 확대/축소 버튼을 둡니다.

**접근성 라벨**
- 누를 수 있는 것에는 모두 `accessibilityRole`과 한국어 `accessibilityLabel`을 붙입니다. 결과가 바로 보이지 않으면 `accessibilityHint`도 붙입니다.
- 선택·토글 상태는 `accessibilityState={{ selected }}` 또는 `{ checked }`로 알립니다 (보정본/원본, 켜짐/꺼짐, A/B 선택).
- 작품 이미지에는 작품 제목과 작가를 라벨로 붙입니다. 영역 터치 박스에는 `label`과 위치("왼쪽 아래")를 붙입니다.
- 화면이 바뀌거나 인식 결과가 나오면 `AccessibilityInfo.announceForAccessibility`로 알립니다.

**색만으로 구분하지 않기**
- 상태(선택됨, 오류, 원본/보정 중)는 색과 함께 **글자나 아이콘**으로도 표시합니다. 와이어프레임처럼 선택된 쪽에 ✓와 굵은 테두리, "최근 방문" 배지, "켜짐/꺼짐" 글자를 씁니다.
- 캘리브레이션 A/B 카드는 색이 아니라 "보기 A / 보기 B" 글자와 실선/점선 테두리로 구분합니다.

**음성 안내 (와이어프레임의 "음성으로도 읽어줌")**
- 와이어프레임에서 "음성으로도 읽어줌" 표시가 있는 문구(질문, 안내, 확인 시트, 오류)는 `src/hooks/use-speech.ts`의 `speak()`로 읽습니다. 화면마다 `Speech.speak`를 직접 부르지 않습니다.
- 화면을 떠날 때 `Speech.stop()`을 반드시 호출합니다 (`use-speech`가 처리).
- TTS 목소리는 기기마다 달라지지 않도록 고정합니다 (iOS는 Yuna 우선, 고음질 버전이 있으면 그것).

**VoiceOver/TalkBack과 TTS 충돌**
- 스크린리더가 켜져 있으면 안내 TTS와 스크린리더 음성이 겹칩니다. `AccessibilityInfo.isScreenReaderEnabled()`가 참이면 안내 문구는 TTS 대신 `announceForAccessibility`로 보냅니다 (`use-speech`가 처리).
- 해설(3)은 화면 진입 시 **자동 재생하지 않고**, 사용자가 재생을 눌렀을 때만 재생합니다.
- 스크린리더 사용자에게 해설을 TTS로 들려줄지 스크린리더로 읽게 할지는 9장 미결정 1번입니다.

---

## 8. Git 규칙

**브랜치**
- `main`에서 따서 작업하고 PR로 `main`에 머지합니다. `main`에 직접 push하지 않습니다. (원격에 `develop`이 있으니 BE와 기준 브랜치를 맞춰야 하면 이 줄을 고칩니다.)
- 이름: `feat/<화면명>` (예: `feat/number-input`, `feat/capture`), 버그는 `fix/<내용>`, 설정·문서는 `chore/<내용>`, `docs/<내용>`.
- 브랜치 하나에 화면 하나. 오래 끌지 말고 작게 자주 머지합니다.

**커밋**
- 형식: `<type>(<범위>): <한국어 요약>` — 예: `feat(number): 숫자 키패드와 번호 읽어주기 추가`, `fix(artwork): 줌 상태에서 원본 전환 시 위치 초기화`
- type: `feat` / `fix` / `refactor` / `style` / `docs` / `chore`
- 본문은 필요할 때만, "왜"를 적습니다.

**PR**
- 제목은 커밋 형식과 같게. 본문에 **와이어프레임 번호, 무엇을, 어떻게 확인했는지(iOS/Android, 스크린리더, 큰 글씨, 고대비)**, 스크린샷을 넣습니다.
- `npx expo lint`, `npx tsc --noEmit` 통과 후 올립니다.
- 상대방 1명 승인 후 머지합니다. 머지는 PR 올린 사람이 합니다 (squash merge).
- 머지 후 5.1 표의 상태를 `완료`로 바꿉니다.

**공통 파일을 고칠 때**

아래 파일은 두 사람이 모두 영향을 받습니다. 고치기 전에 **먼저 말하고**, 화면 작업과 섞지 말고 **별도 PR**로 올립니다.

- `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/(home)/_layout.tsx`
- `src/constants/*`, `src/types/*`, `src/components/common/*`, `src/lib/api.ts`, `src/store/*`, `src/hooks/use-speech.ts`, `src/hooks/use-profile.ts`
- `package.json`, `package-lock.json`, `app.json`
- 이 README

`package-lock.json` 충돌이 나면 직접 고치지 말고, `main`의 lock 파일을 받은 뒤 `npx expo install`로 자기 패키지만 다시 추가합니다.

BE API 모양을 바꿔야 하면 FE끼리 정하지 말고 BE 담당에게 이슈나 메시지로 요청합니다. 바뀐 뒤 6장을 고칩니다.

---

## 9. 결정 사항, BE 요청, 미결정 사항

### 9.1 결정됨

| 항목 | 결정 | 반영 |
|---|---|---|
| 로그인 | **로그인·회원가입 사용** (2026-11-11 변경). 실제 `/auth/login`, `/auth/register`, `/auth/logout`에 연결하고 휴대폰 세션은 SecureStore에 보관. 보기 설정은 계정 로그인과 별개로 이 기기에 저장하며 AI API는 기존처럼 비회원 호출도 지원 | 5.1, 5.2, 6.4 |
| 촬영 방식 | **자동 촬영을 넣는다**. 디자인에는 셔터 버튼이 있어 지금은 셔터로 찍는다. 자동 촬영을 붙인 뒤 셔터를 남길지는 9.3에서 정한다. [tech-review 1-1](../docs/tech-review.md#1-결정-사항)도 자동 촬영 지원으로 반영됨 | 6.3 |
| 음성으로 작품 찾기 | **버튼은 화면에 넣는다.** 누르면 "준비 중" 안내만 하고, 기능(음성 인식)은 dev build로 바꿀 때 붙인다 | 3, 5.2 |
| 하단 탭 | **홈 · 카메라 · 마이** (디자인). 화면 위에 떠 있는 알약 모양. 선택된 탭은 머스터드 배경 (디자인의 회색은 라이트 모드에서 안 보여서 바꿈). 관람 기록은 마이페이지에서 들어감 | 4 |
| 디자인 vs 와이어프레임 | 다르면 **디자인**([docs/design/](docs/design/))을 따른다. 색은 디자인의 `#FFB800`·검정 배경 대신 `constants/a11y.ts` 팔레트(머스터드·차콜, 라이트/다크)를 쓴다 | 1, 7 |
| 담당 | 홈 · 1-0 · 번호 입력을 A에서 B로 옮김 | 5.1 |
| 인식 신뢰도 | **BE가 나눠서 준다.** FE는 기준값을 갖지 않는다 | 6.3 |

### 9.2 BE 요청 및 반영 상태

| # | 요청 | 쓰는 화면 | 상태 |
|---|---|---|---|
| 1 | 미술관 목록 API, 작품에 `museum_id`와 미술관별 작품 번호 필드, **미술관 + 번호로 작품 조회** API, QR 내용 형식 합의 (`momi://artwork/<id>` 딥링크 vs 작품 id 문자열. 앱 scheme은 `momi`) | 1, 1-0, 1-1, 1-2 | BE 구현: `/museums`, `museum_id`, `number`, ID+번호 조회. QR은 `momi://artwork/<id>`로 확정. FE 연결 별도 |
| 2 | (P1) 자동 촬영 위치 안내용: 사진 안에서 작품이 차지하는 영역(bbox)이나 "왼쪽/오른쪽/가까이" 같은 방향 힌트를 `/recognize`의 `quality`에 추가 | 4 | BE 구현: `quality.artwork_bbox`, `framing_hint`. 원본과 특징점 대응 검증 성공 시만 제공, 그 외 null |
| 3 | `/recognize` 응답에 `confidence: "high" \| "medium" \| "low"` 추가. 기준은 실제 촬영본으로 BE·AI가 정함 (tech-review 6.3 신뢰도 보정). 기준이 없을 때는 `medium`으로 | 4, 4-1, 4-2 | BE 구현: 후보는 기본 medium, 후보 없음 low. 실제 촬영 평가 후 환경변수로 high 기준 설정 |
| 4 | (P1) `/narration`의 `segments`마다 해당 `regions` 번호 (`region_index`) — 해설 중 "지금 설명하는 영역" 표시용 | 3 | BE·AI 생성 스키마 반영: segment마다 `region_index`(0 기반 또는 null). 기존 해설은 연결 검수 후 재등록 필요 |
| 5 | 자동 촬영은 1~2초마다 `/recognize`를 부르므로, 요청 횟수 제한이 걸리지 않는지 확인 (`artwork`는 60회/60초, `placard`는 분당 5회 공유) | 4 | 1초 간격 계약 테스트 통과. 진행 중 요청은 겹치지 않음. 429/503은 Retry-After 대기. 실제 배포 서버·촬영본 부하 검증은 별도 |

세부 응답·null 처리·호출 제한은 [API 명세](../docs/api-spec.md), 실측 범위는 [부하 기록](../docs/recognition-load.md)을 참고합니다.

### 9.3 미결정

| # | 항목 | 쟁점 | 결정 |
|---|---|---|---|
| 1 | 스크린리더 켰을 때 해설 방식 | expo-speech TTS vs `announceForAccessibility` 중 기본값 | TODO |
| 2 | 캘리브레이션 | [AI 합의 규칙](../docs/ai-calibration.md), 청색판 포함 복수 실패는 직접 고르기. 로컬 필드 `color_type`, `severity`, `edge`, `contrast` 사용 | 구현 |
| 3 | 로그인·회원가입 | 실제 API 연결. 로그인 → 기기 보기 설정 확인 → 온보딩 또는 홈 | 구현 |
| 4 | 자동 촬영 세부값 | 촬영 간격, 포기 시간(예: 15초), 셔터음 처리. 실기기에서 정함 | TODO |
| 5 | 배경 음악 | 2의 "음악 듣기"와 8의 "배경 음악 자동 재생". 음원과 `mood_keywords` 매핑은 누가 준비하는지, P2 유지 여부 | TODO |
| 6 | 촬영 셔터 | 디자인의 셔터 버튼과 9.1의 자동 촬영을 같이 둘지 (자동 촬영 + 셔터는 수동 재시도용 등) | TODO |

## 2026-11-11 인증·보기 설정 반영

- 첫 실행은 로그인. 회원가입 성공 시 즉시 로그인되며 보기 설정이 없는 기기는 온보딩으로 이동합니다. 로그아웃은 서버 세션을 무효화하고 기기 토큰을 지웁니다.
- 원격 기능 병합 후 `store/profile.ts`를 공용 기기 프로필 저장소로 사용합니다. `calibration`에 `color_type`, `severity`, `edge`를, 프로필에 `contrast`, `brightness`, `sharpen`을 저장합니다. 기존 `swaithon.viewing.v1` 값은 최초 로드 시 단위를 유지하여 이전합니다. 서버에 자동 동기화하지 않습니다.
- 마이페이지에서 종류·색 보정·선 굵기·대비(0.5~2)·밝기(-1~1)·선명도를 조정할 수 있습니다. 저장 전 미리보기는 CALIBRATION의 색/윤곽선 그림을 각각 사용합니다.
- 작품 화면은 서버 `/correction`으로 색·윤곽선만 적용합니다. 서버에는 항상 `contrast: 1`, `brightness: 0`, `sharpness: 0`을 보내고 앱 Skia에서 밝기·대비·선명도를 적용합니다. 성공한 서버 이미지는 재사용하고 슬라이더 이동 중 호출을 지연합니다.
- 확인 명령: `node --test scripts/tests/auth-calibration.test.cjs`, `npx expo lint`, `npx tsc --noEmit`.

- 원격 develop의 온보딩 소개·캘리브레이션·결과 화면, 보정 세부 조정, 글씨 크기·해설 방식 설정, 관람 기록을 통합했습니다. 관람 기록의 당시 프로필도 서버 색·윤곽선 보정에 동일하게 적용됩니다.

## 지현님 구현 우선 (2026-11-11)

- 첫 홈 진입에만 소개를 띄우고, 직접 연 화면은 소개로 가로채지 않습니다. 로그인 연결은 유지합니다.
- 마이페이지 상단 계정 카드는 제거하고 지현님 설정 UI를 유지합니다. 로그아웃은 하단에 있습니다.
- 촬영은 후보가 있으면 첫 후보로 바로 이동하며, 후보가 없으면 작품 찾기 실패 화면으로 이동합니다. 별도 후보 확인·즉시 미등록 AI 분석 모달은 제공하지 않습니다.
- 저장된 해설 방식을 조회 API에 전달합니다. 실제 작품 데이터, 등록 작품 AI 음성 해설, 서버 보정 연결은 유지합니다.
- 전체 차이는 [구현 비교 기록](../docs/fe-implementation-comparison.md)에 있습니다.

앱·프로젝트 표기는 **MoMi**입니다. 기존 기기 저장 키와 실제 GitHub 저장소 URL은 호환성을 위해 유지합니다. 신규 작품 QR은 `momi://artwork/<id>`를 사용하며 기존 QR도 읽을 수 있습니다.

## OpenAI 해설 목소리 (2026-11-11)

- 음성 해설 화면은 OpenAI 음성을 기본 선택으로 사용합니다. ‘기기 음성’으로 직접 전환할 수 있습니다. OpenAI 키는 BE의 `.env`에만 둡니다.
- Gemini 해설 생성과 음성 합성은 별개입니다. `/speech`로 한 문장씩 WAV를 받아 `expo-audio`로 재생합니다. 준비 상태·연결 실패·AI 생성 음성 안내를 표시합니다.
- 캐시한 문장은 반복·속도 조절에 재사용합니다. 화면을 떠나거나 다음 문장으로 넘기면 이전 비동기 결과는 자동 재생하지 않습니다.
- 재생 전용 설정이며 마이크 권한·백그라운드 녹음을 사용하지 않습니다. 짧은 안내·접근성 안내의 `expo-speech`는 유지합니다.
- 테스트: `node --test scripts/tests/*.test.cjs`. 실제 음색·API 계정 접근·기기 재생은 키 설정 후 별도 확인이 필요합니다.
