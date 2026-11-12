# v3 서버 연결 검증

**연결 코드와 테스트는 완료했지만, 4032px 서버 전체 처리 3.228초로 성능 기준에 미달했다. 사용자의 중단 조건에 따라 추가 측정·최적화 및 GitHub 반영을 중단했다. 기본값은 `selective`다. 커밋·푸시는 하지 않았다.**

2026-11-13. 작업 브랜치: `feat/cluster-color-correction-mode`.
시작 브랜치는 `feat/ai-recognition-refs`였으며, 기존 v3 작업 파일을 유지한 상태에서 새 브랜치를 만들었다.
기존 사용자 변경 및 제외 경로는 보존했다.

## 동작

- [서버 보정](../../../Backend/ai/correction.py)은 `COLOR_CORRECTION_MODE`가 없으면 기존 `selective`를 사용한다. `cluster`일 때만 적색약·녹색약을 v3로 보낸다. 알 수 없는 값도 `selective`다.
- [서버용 v3 연결](../../../Backend/ai/server_cluster.py)은 긴 변 최대 1000px 사본에서 k-means 12군집·48회 최적화·후보 검증을 수행한다. 원본 크기에는 계산한 색 이동과 픽셀별 색 변화 제한을 적용한다. 기존 A'의 선택 마스크 분석도 최대 600px에서 한다. 작은 입력은 확대하지 않는다.
- 청색약 계산식, 밝기·대비·선명도·윤곽 계산식과 적용 순서는 그대로다. 적색약·녹색약 동시 설정은 기존 순서대로 각각 보정한다.
- [네이티브 연결](../../../Backend/ai/local_native.py)은 여러 요청의 첫 실행이 겹쳐도 초기화가 끝난 표만 공유한다. 요청별 최적화 계수는 공유하지 않는다. C 계산식은 변경하지 않았다.
- 서버 보정 응답에는 기존대로 `no-store`가 적용된다. [라우트](../../../Backend/ai_routes.py)의 인증된 `GET /correction/config`와 `X-Correction-Mode`로 현재 모드를 알린다. [CORS](../../../Backend/main.py)는 이 헤더를 앱에 노출한다.
- [앱 캐시](../../../Frontend/src/lib/api.ts)의 키에 모드를 포함했다. 캐시를 반환하기 전에도 서버 모드를 확인하고 모드 변경 시 예전 결과를 버린다. 모드가 다른 진행 중 응답은 저장하지 않는다. [이미지 훅](../../../Frontend/src/hooks/use-corrected-artwork.ts)도 모드 변경을 구독한다.

## 테스트

- 서버 전체 `unittest`: **238/238 통과**. 기본 `selective`와 모드 전환 검사를 포함한다.
- [기존 출력 고정값](../../../Backend/tests/fixtures/correction_selective_v1.json): 코드 변경 전에 저장한 17개 프로필에 대해 기본값과 명시적 `selective` 모두 float32 배열 SHA-256 및 JPEG 바이트 SHA-256 완전 일치.
- [모드별 검사](../../../Backend/tests/test_server_cluster.py): 적색약·녹색약 분기, 청색약·다른 보정 유지, 1000px 분석 제한, 원본 크기 유지, 작은 입력의 v3 동등성, 픽셀별 변화 제한, 동시 네이티브 초기화, API·캐시 헤더를 검사했다.
- 앱 전체 Node 테스트 **95/95 통과**, TypeScript `--noEmit` 통과, Expo lint 통과. [앱 모드 검사](../../../Frontend/scripts/tests/auth-calibration.test.cjs)는 모드 변경에 따른 재생성·진행 중 응답 폐기를 포함한다.
- Windows 전체 검사 중 드러난 테스트 정리 문제는 [SQLite 백업 테스트](../../../Backend/tests/test_demo_safety.py)와 [피드백 테스트](../../../Backend/tests/test_feedback.py)에서 연결을 명시적으로 닫도록 수정했다. 권한 검사는 Windows에서도 `chmod(0600)` 호출을 확인하고 POSIX 환경에서만 실제 POSIX 비트를 비교한다. 운영 DB 코드는 변경하지 않았다.

```powershell
$env:PYTHON_DOTENV_DISABLED = '1'
$env:COLOR_CORRECTION_MODE = 'selective'
.\Backend\.venv\Scripts\python.exe -m unittest discover -s Backend/tests -q
cd Frontend
node --test scripts/tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit
$env:EXPO_NO_DOTENV = '1'
npm.cmd run lint
```

## 처리 시간

[측정 스크립트](../../../Backend/benchmark_correction.py)는 서버의 입력 정규화 → 보정 → 출력 검증·정규화 전체를 측정한다. 파일 읽기·네트워크·계정 DB 시간은 제외한다. 보정 함수 자체 시간도 별도로 기록한다. CPU 스레드 수는 변경하지 않는다. 모듈 import 후 별도 예열 없이 첫 호출부터 잰다. 첫 3초 초과 사례에서 남은 측정을 중단한다.

동일한 촬영 원본(파일상 4032×3024px, EXIF 방향 정규화 후 3024×4032px)과 이를 960×1280px로 줄인 별도 입력을 사용했다. 이 사진은 색 정확도 평가용 작품 세트가 아니며 처리 시간 확인용이다. `max_side=1280`은 기존 API에서 보정 후 출력 크기를 줄이는 옵션이므로, 1280px **입력** 측정과 다르다. 원본을 1280px로 줄인 보정 결과로 대체하지 않았다.

측정: 2026-11-13 07:05 KST, Windows / Python 3.12.16 / NumPy 2.5.4 / OpenCV 5.0.0 / 기본 OpenCV 18스레드 / 사전 빌드 C 커널 사용. BLAS·OMP 스레드 환경변수는 설정하지 않았다. 각 항목 1회이며 반복·동시 요청의 최악 시간 보장은 아니다.

| 정규화 후 입력 크기 | 유형·세기 | 보정 함수 자체 | 서버 이미지 처리 전체 | 판정 |
|---|---|---:|---:|---|
| 960×1280 | 적색약 1.0 | 0.797초 | 0.849초 | 3초 이내 |
| 960×1280 | 녹색약 1.0 | 0.588초 | 0.640초 | 3초 이내 |
| 3024×4032 | 적색약 1.0 | 2.677초 | **3.228초** | **초과·중단** |
| 3024×4032 | 녹색약 1.0 | — | — | 앞 사례 초과로 미측정 |

세 사례 모두 `too_few_lost_pairs`로 v3 잔여 이동의 최적화 후보가 생성되지 않아 기존 A'로 복귀했다. 따라서 위 시간으로 **48회 최적화와 원본 크기 잔여 색 이동까지 수행하는 경로의 성능을 입증하지 않는다**. 그보다 작업이 적은 복귀 경로에서도 서버 전체 처리가 3초를 넘었기 때문에 추가 사례를 측정하거나 속도 설정을 바꾸지 않았다. 2.677초는 JPEG 입력→출력 보정 함수 자체 시간이며, 3.228초는 API가 실제로 수행하는 입력 정규화와 출력 검증·정규화까지 포함한 시간이다.

[원측정 JSON](server-benchmark.json)에 입력 해시·출력 해시·분석 크기·복귀 사유·환경을 기록했다. 실행한 명령은 다음과 같다. 스크립트는 첫 3초 초과 후 결과를 저장하고 실패 종료한다.

```powershell
$env:PYTHON_DOTENV_DISABLED = '1'
.\Backend\.venv\Scripts\python.exe -m Backend.benchmark_correction --image Backend/data/eval/not_artwork/KakaoTalk_20261111_000942431_12.jpg --output docs/experiments/palette-v3/server-benchmark.json
```

원본 해상도의 모든 활성 색 보정 경로와 다중 유형 동시 설정은 성능 검증이 남아 있다. `develop` 반영 조건은 충족하지 않았다. 이번 중단 이후 구현·설정을 추가로 변경하지 않았으며 측정 기록만 정리했다.

## 켜는 방법

서버 환경에 `COLOR_CORRECTION_MODE=cluster`를 추가한 뒤 서버를 재시작한다. 기본값은 `selective`다.
이번 작업에서 `.env` 파일은 열거나 수정하지 않았다. 실제 실행 중인 서버·앱 설정도 바꾸지 않았다.
현재 컴퓨터에는 사전 빌드된 선택적 C 커널이 있다. 새 서버에서 같은 속도를 기대하려면 해당 플랫폼에서 [네이티브 빌드](../../../Backend/ai/local_native.py)를 준비하고 다시 시간을 검증해야 한다. DLL 등 빌드 결과는 커밋 대상이 아니다.

## 기존 실험과의 관계

[v3 실험 보고서](report.md)의 회복률과 1.293초는 이전에 고정한 1000px RGB 배열 실험 결과다. 이번 원본 해상도 서버 성능을 뜻하지 않는다. 서버 연결로 보정 모듈과 네이티브 초기화 코드가 변경되었으므로 과거 [코드 고정 기록](frozen.json)을 현재 코드로 덮어쓰지 않는다. 원본 해상도 출력의 독립 모델 회복률은 이번 연결 검사에서 다시 측정하지 않았다.

성능 기준까지 통과할 때만 사용자가 추가 요청한 GitHub `develop` 반영을 진행한다. 3초 초과 시 작업과 푸시를 보류한다. `Frontend/src/lib/background-music.ts`, `_handoff/`, `Backend/data/`는 커밋하지 않는다.
