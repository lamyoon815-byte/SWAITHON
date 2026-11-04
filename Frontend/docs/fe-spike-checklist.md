# FE 검증 스파이크 체크리스트

`npx expo start` → Expo Go로 iOS·Android 실기기에서 **Spike** 탭을 열고 아래를 확인한다.
결과 칸에 `검증 완료` / `변경 필요 (사유)`를 적어 팀에 공유한다.

## 스택 표 (FE)

| 항목 | 버전 (SDK 58) | Expo Go 포함 | iOS | Android | 메모 |
|---|---|---|---|---|---|
| @shopify/react-native-skia | 2.14.0 | ✅ (문서 확인) | ✅ 120fps, 샤프닝 OK | | |
| react-native-reanimated / worklets | 4.7.1 / 0.13.0 | ✅ | ✅ | | |
| react-native-gesture-handler | 3.3.0 | ✅ | ✅ | | v3 훅 API (`usePinchGesture` 등) 사용 |
| @react-native-community/slider | 5.2.1 | ✅ | ✅ | | |
| expo-speech | ~58.0.3 | ✅ (문서 확인) | ✅ 한국어 음성 9개 | | |
| expo-image-manipulator | ~58.0.15 | ✅ (문서 확인) | ✅ | | `manipulateAsync`는 deprecated → `ImageManipulator.manipulate` |
| expo-camera | ~58.0.12 | ✅ | ✅ 촬영·리사이즈 | | 입력이 촬영만으로 결정돼 P0 (tech-review 1-1). Expo Go는 권한이 이미 있어 권한 팝업은 별도 빌드에서 확인 |
| @react-native-async-storage/async-storage | 2.2.0 | ✅ | | | 스파이크 화면에는 아직 미사용 |

## 항목별 확인 포인트

**1. 보정 (Skia ColorMatrix)**
- [ ] 대비·밝기·강도 슬라이더를 움직이는 동안 이미지가 끊김 없이 바로 바뀐다
- [ ] 원본/보정 전환 버튼이 즉시 반영된다
- 화면의 `UI FPS 평균/최저` 값을 기록 (참고치: UI 스레드 기준)
- [ ] **선명도** 슬라이더(RuntimeShader 언샤프 마스크)를 올리면 윤곽이 또렷해지고, 2.0에서 지저분하게 깨지지 않는지
- [ ] 선명도를 올린 상태에서 확대·이동할 때 FPS가 떨어지는지 (기록)

**2. 줌 (gesture-handler + reanimated, Skia transform)**
- [ ] 핀치 줌, 두 손가락 이동, 더블탭 확대/복귀가 동작한다
- [ ] 8배까지 확대해도 붓터치가 선명하다 (3840×3041 원본)
- [ ] 줌 중 FPS 최저값이 크게 떨어지지 않는다 (기록)
- [ ] `로드+디코드` ms 기록 (개발 모드에서는 Metro 다운로드 포함)
- [ ] VoiceOver/TalkBack을 켜면 핀치가 막히므로 `확대 +/축소 −` 버튼과 배율 안내가 동작하는지 본다

**3. 음성 (expo-speech)**
- [ ] 한국어 음성이 있는지 (없으면 화면에 설치 안내가 뜸)
- [ ] 0.75x~1.5x 속도가 실제로 다르게 들린다 (iOS와 Android의 속도 체감이 다를 수 있음)
- [ ] 반복 켜기 → 끝나면 다시 재생, 정지 누르면 멈춤
- [ ] `시작까지 ms` 기록
- [ ] iOS: 무음 모드에서는 소리가 나지 않는 것 확인

**4. 리사이즈 · 업로드**
- [ ] `1024px 리사이즈 측정` → 결과 크기, 용량, ms 기록
- [ ] 업로드는 `EXPO_PUBLIC_UPLOAD_URL=http://<PC IP>:8000/<경로> npx expo start`로 BE 엔드포인트를 지정했을 때만 실행됨 (multipart 필드명 `image`)

**5. 큰 글씨 · 고대비 · 스크린리더**
- [ ] 시스템 글꼴 크기를 최대로 → 앱 복귀 시 `글꼴 배율`이 바뀌고 글자/버튼이 잘리지 않는다
- [ ] 굵은 텍스트, 대비 증가(iOS) / 고대비 텍스트(Android) 상태가 표시된다
- [ ] 고대비 토글 → 검정/흰색/노랑 팔레트로 전환
- [ ] **스크린리더 켠 상태에서 `해설 듣기`**: 스크린리더 안내와 TTS가 겹치거나 끊기는지 → `스크린리더로 읽기`(announceForAccessibility)와 비교해서 어느 쪽을 기본으로 할지 결정

**6. 카메라 촬영 (expo-camera)**
- [ ] `카메라 켜기` → 권한 팝업 → 미리보기가 나온다
- [ ] `촬영` → 촬영 결과(크기, 용량, ms)와 1024px 리사이즈 결과가 표시되고 사진이 보인다
- [ ] 액자 속 작품(모니터 화면도 가능)을 찍었을 때 반사광과 흐림이 어느 정도인지 눈으로 확인

## 알려진 제약
- 캔버스 위에서 드래그하면 이미지 이동으로 처리되어 스크롤되지 않는다. 캔버스 밖을 드래그해 스크롤한다.
- 스파이크 화면은 모바일 전용이다. 웹에서 Skia를 쓰려면 CanvasKit 설정이 별도로 필요하다.
