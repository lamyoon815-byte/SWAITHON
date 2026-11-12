# 비지도 군집화 + 최적화 색 보정 실험

**판정: 이번 설정은 개선되지 않았다.**

실행: 2026-11-13T00:09:34.399060+09:00 / 등록 작품 21점 × 3유형, 검사판 12장 × 3세기.
[사전 고정 계획](protocol.md)에 따라 A'(기존 선택 보정)와 B(k-means + 최적화)를 비교했다.
B는 Machado만으로 최적화했다. 아래 회복률은 최적화에 쓰지 않은 모델에서 잰 시뮬레이션 지표다.

## 사전 조건 판정

| 조건 | 결과 |
|---|---|
| 네 모델·각 유형의 구분 회복률 상승 | 실패 |
| 각 작품·유형의 평균 색 변화 증가 없음 | 통과 |
| 검사판 유형·모델·세기별 평균 선명도 유지 | 실패 |
| 1000px 작품 보정 최대 3.0초 이내 | 실패 |

- 회복률 기준 실패: brettel/protan, brettel/deutan, brettel/tritan, vienot/protan, vienot/deutan, vienot/tritan, vischeck/protan, vischeck/deutan, vischeck/tritan, hpe/protan, hpe/deutan, hpe/tritan
- 색 변화 예산 초과 0건, 검사판 평균 하락 32/36셀, 시간 초과 27/63건.
- 색 변화 예산은 방법에 내장된 제약이므로, 색 변화 조건 통과 자체는 성능 향상의 증거가 아니다.

## 작품 전체 구분 회복률

정상 시각 ΔE > 15, 보정 전 모사에서 차이가 절반 미만인 픽셀 쌍을 고정한다.
보정 뒤 절반 이상이면 회복. 표는 회복 수/손실 쌍 수를 합친 micro 값이다.

| 평가 모델 | 유형 | 손실 쌍 수 | A' | B | 차이(%p) | A'→B 새 충돌률 |
|---|---|---:|---:|---:|---:|---:|
| brettel | protan | 16590 | 67.59% | 37.38% | -30.20 | 5.36% → 0.22% |
| brettel | deutan | 12099 | 77.19% | 29.65% | -47.54 | 4.06% → 0.14% |
| brettel | tritan | 42262 | 48.37% | 37.36% | -11.01 | 10.26% → 0.59% |
| brettel | all | 70951 | 57.78% | 36.05% | -21.73 | 6.48% → 0.31% |
| vienot | protan | 16562 | 68.25% | 37.41% | -30.84 | 5.40% → 0.21% |
| vienot | deutan | 11244 | 80.67% | 30.62% | -50.04 | 3.85% → 0.13% |
| vienot | tritan | 40437 | 52.28% | 38.89% | -13.39 | 10.32% → 0.59% |
| vienot | all | 68243 | 60.83% | 37.17% | -23.67 | 6.44% → 0.31% |
| vischeck | protan | 15563 | 69.22% | 37.09% | -32.13 | 5.37% → 0.19% |
| vischeck | deutan | 11279 | 78.92% | 26.67% | -52.25 | 3.72% → 0.15% |
| vischeck | tritan | 43152 | 51.84% | 37.30% | -14.54 | 9.99% → 0.61% |
| vischeck | all | 69994 | 60.07% | 35.54% | -24.53 | 6.27% → 0.31% |
| hpe | protan | 14913 | 71.19% | 37.69% | -33.50 | 5.45% → 0.19% |
| hpe | deutan | 11749 | 77.95% | 28.04% | -49.90 | 3.92% → 0.14% |
| hpe | tritan | 43859 | 48.93% | 36.54% | -12.40 | 9.93% → 0.59% |
| hpe | all | 70521 | 58.47% | 35.37% | -23.11 | 6.35% → 0.30% |

## 색 변화와 처리 시간

| 항목 | A' | B |
|---|---:|---:|
| 작품·유형별 평균 ΔE76의 평균 | 5.7328 | 0.7038 |
| 보정 시간 중앙값(초) | 0.5176 | 2.7090 |
| 보정 시간 최대값(초) | 3.2092 | 7.1381 |

긴 변 최대 1000px의 RGB 배열 기준. B 시간에는 A' 계산 및 색 변화 예산 계산이 포함된다.
파일 읽기, 평가 모델 실행, 비교 그림 저장, JPEG 인코딩은 제외했다. 단일 실행으로 반복 측정 분산은 추정하지 않았다.
환경: Python 3.12.16, NumPy 2.5.4, OpenCV 5.0.0, Windows-11-10.0.26300-SP0.

## 검사판 숫자 선명도

숫자 점과 바탕 점 평균 Lab의 ΔE76이며, 숫자를 읽은 정답률은 아니다. 각 셀은 같은 유형 4장 평균.

| 모델 | 유형 | 보정 세기 | A' | B | 하락한 개별 판 수 | 판정 |
|---|---|---:|---:|---:|---:|---|
| brettel | protan | 0.2 | 19.225 | 2.746 | 4/4 | 실패 |
| brettel | protan | 0.6 | 35.998 | 9.194 | 4/4 | 실패 |
| brettel | protan | 1.0 | 42.742 | 15.372 | 4/4 | 실패 |
| brettel | deutan | 0.2 | 21.123 | 3.043 | 4/4 | 실패 |
| brettel | deutan | 0.6 | 41.250 | 8.494 | 4/4 | 실패 |
| brettel | deutan | 1.0 | 48.209 | 13.636 | 4/4 | 실패 |
| brettel | tritan | 0.2 | 7.764 | 7.503 | 4/4 | 실패 |
| brettel | tritan | 0.6 | 18.721 | 19.059 | 1/4 | 통과 |
| brettel | tritan | 1.0 | 38.095 | 31.405 | 4/4 | 실패 |
| vienot | protan | 0.2 | 19.165 | 2.731 | 4/4 | 실패 |
| vienot | protan | 0.6 | 35.970 | 9.139 | 4/4 | 실패 |
| vienot | protan | 1.0 | 42.800 | 15.276 | 4/4 | 실패 |
| vienot | deutan | 0.2 | 21.794 | 3.117 | 4/4 | 실패 |
| vienot | deutan | 0.6 | 42.638 | 8.716 | 4/4 | 실패 |
| vienot | deutan | 1.0 | 49.918 | 14.004 | 4/4 | 실패 |
| vienot | tritan | 0.2 | 7.615 | 7.380 | 4/4 | 실패 |
| vienot | tritan | 0.6 | 18.762 | 18.809 | 1/4 | 통과 |
| vienot | tritan | 1.0 | 39.874 | 31.265 | 4/4 | 실패 |
| vischeck | protan | 0.2 | 17.842 | 4.784 | 4/4 | 실패 |
| vischeck | protan | 0.6 | 34.944 | 10.462 | 4/4 | 실패 |
| vischeck | protan | 1.0 | 41.998 | 16.231 | 4/4 | 실패 |
| vischeck | deutan | 0.2 | 17.716 | 6.988 | 4/4 | 실패 |
| vischeck | deutan | 0.6 | 38.055 | 9.921 | 4/4 | 실패 |
| vischeck | deutan | 1.0 | 45.127 | 14.048 | 4/4 | 실패 |
| vischeck | tritan | 0.2 | 9.149 | 8.564 | 4/4 | 실패 |
| vischeck | tritan | 0.6 | 20.152 | 20.369 | 1/4 | 통과 |
| vischeck | tritan | 1.0 | 39.565 | 32.784 | 4/4 | 실패 |
| hpe | protan | 0.2 | 16.530 | 6.433 | 4/4 | 실패 |
| hpe | protan | 0.6 | 34.041 | 12.070 | 4/4 | 실패 |
| hpe | protan | 1.0 | 41.385 | 17.770 | 4/4 | 실패 |
| hpe | deutan | 0.2 | 18.773 | 4.602 | 4/4 | 실패 |
| hpe | deutan | 0.6 | 38.965 | 8.953 | 4/4 | 실패 |
| hpe | deutan | 1.0 | 45.929 | 13.704 | 4/4 | 실패 |
| hpe | tritan | 0.2 | 9.141 | 8.747 | 4/4 | 실패 |
| hpe | tritan | 0.6 | 20.019 | 20.280 | 1/4 | 통과 |
| hpe | tritan | 1.0 | 39.612 | 32.575 | 4/4 | 실패 |

## 작품별 결과

Brettel 기준. 다른 모델, 저표본 표시, 인접 경계 지표는 원자료에 모두 포함한다.

| 작품 | 유형 | A' 회복률 | B 회복률 | A' ΔE | B ΔE | B 시간(초) | 비교 |
|---|---|---:|---:|---:|---:|---:|---|
| 사이프러스가 있는 밀밭 | protan | 74.93% | 2.06% | 3.119 | 0.042 | 2.792 | [보기](../../../Backend/data/eval/palette-v1/panels/met-01-protan.jpg) |
| 사이프러스가 있는 밀밭 | deutan | 77.45% | 3.43% | 2.486 | 0.061 | 2.903 | [보기](../../../Backend/data/eval/palette-v1/panels/met-01-deutan.jpg) |
| 사이프러스가 있는 밀밭 | tritan | 34.16% | 23.71% | 9.796 | 0.810 | 2.312 | [보기](../../../Backend/data/eval/palette-v1/panels/met-01-tritan.jpg) |
| 이아 오라나 마리아 (마리아를 경배하며) | protan | 67.27% | 55.33% | 6.860 | 1.623 | 2.944 | [보기](../../../Backend/data/eval/palette-v1/panels/met-02-protan.jpg) |
| 이아 오라나 마리아 (마리아를 경배하며) | deutan | 69.34% | 49.49% | 5.302 | 1.111 | 2.768 | [보기](../../../Backend/data/eval/palette-v1/panels/met-02-deutan.jpg) |
| 이아 오라나 마리아 (마리아를 경배하며) | tritan | 41.94% | 26.22% | 10.325 | 1.018 | 3.007 | [보기](../../../Backend/data/eval/palette-v1/panels/met-02-tritan.jpg) |
| 사자의 식사 | protan | 24.14% | 34.48% | 1.046 | 0.255 | 3.265 | [보기](../../../Backend/data/eval/palette-v1/panels/met-03-protan.jpg) |
| 사자의 식사 | deutan | 22.00% | 0.00% | 0.630 | 0.000 | 1.147 | [보기](../../../Backend/data/eval/palette-v1/panels/met-03-deutan.jpg) |
| 사자의 식사 | tritan | 86.35% | 29.88% | 4.885 | 0.450 | 3.097 | [보기](../../../Backend/data/eval/palette-v1/panels/met-03-tritan.jpg) |
| 가나가와 해변의 높은 파도 아래 (거대한 파도) | protan | 11.11% | 0.00% | 0.300 | 0.000 | 1.347 | [보기](../../../Backend/data/eval/palette-v1/panels/met-04-protan.jpg) |
| 가나가와 해변의 높은 파도 아래 (거대한 파도) | deutan | 0.00% | 0.00% | 0.126 | 0.000 | 1.150 | [보기](../../../Backend/data/eval/palette-v1/panels/met-04-deutan.jpg) |
| 가나가와 해변의 높은 파도 아래 (거대한 파도) | tritan | 0.00% | 0.00% | 10.505 | 0.000 | 0.827 | [보기](../../../Backend/data/eval/palette-v1/panels/met-04-tritan.jpg) |
| 멜랑콜리아 I | protan | 해당 쌍 없음 | 해당 쌍 없음 | 0.031 | 0.000 | 0.921 | [보기](../../../Backend/data/eval/palette-v1/panels/met-05-protan.jpg) |
| 멜랑콜리아 I | deutan | 해당 쌍 없음 | 해당 쌍 없음 | 0.032 | 0.000 | 1.084 | [보기](../../../Backend/data/eval/palette-v1/panels/met-05-deutan.jpg) |
| 멜랑콜리아 I | tritan | 해당 쌍 없음 | 해당 쌍 없음 | 5.719 | 0.000 | 0.926 | [보기](../../../Backend/data/eval/palette-v1/panels/met-05-tritan.jpg) |
| 서커스 퍼레이드 | protan | 67.18% | 16.08% | 4.163 | 0.491 | 3.078 | [보기](../../../Backend/data/eval/palette-v1/panels/met-06-protan.jpg) |
| 서커스 퍼레이드 | deutan | 64.64% | 9.89% | 2.666 | 0.345 | 3.035 | [보기](../../../Backend/data/eval/palette-v1/panels/met-06-deutan.jpg) |
| 서커스 퍼레이드 | tritan | 52.10% | 29.69% | 5.479 | 0.616 | 3.262 | [보기](../../../Backend/data/eval/palette-v1/panels/met-06-tritan.jpg) |
| 추수하는 사람들 | protan | 34.86% | 0.00% | 2.508 | 0.000 | 0.998 | [보기](../../../Backend/data/eval/palette-v1/panels/met-07-protan.jpg) |
| 추수하는 사람들 | deutan | 42.86% | 0.00% | 1.115 | 0.000 | 1.100 | [보기](../../../Backend/data/eval/palette-v1/panels/met-07-deutan.jpg) |
| 추수하는 사람들 | tritan | 2.29% | 0.00% | 11.166 | 0.000 | 0.635 | [보기](../../../Backend/data/eval/palette-v1/panels/met-07-tritan.jpg) |
| 그랑드 자트 섬의 일요일 오후 | protan | 81.45% | 30.72% | 2.916 | 0.988 | 3.314 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-01-protan.jpg) |
| 그랑드 자트 섬의 일요일 오후 | deutan | 80.62% | 35.39% | 2.908 | 1.046 | 2.319 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-01-deutan.jpg) |
| 그랑드 자트 섬의 일요일 오후 | tritan | 75.46% | 29.86% | 7.554 | 1.551 | 2.161 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-01-tritan.jpg) |
| 침실 | protan | 79.35% | 49.83% | 7.812 | 0.906 | 2.654 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-02-protan.jpg) |
| 침실 | deutan | 83.16% | 28.33% | 6.202 | 1.316 | 2.333 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-02-deutan.jpg) |
| 침실 | tritan | 25.53% | 62.33% | 13.301 | 3.914 | 1.922 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-02-tritan.jpg) |
| 파리의 거리, 비 오는 날 | protan | 53.85% | 43.32% | 1.115 | 0.509 | 2.622 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-03-protan.jpg) |
| 파리의 거리, 비 오는 날 | deutan | 41.86% | 20.16% | 0.733 | 0.444 | 2.325 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-03-deutan.jpg) |
| 파리의 거리, 비 오는 날 | tritan | 62.34% | 0.00% | 4.170 | 0.000 | 0.685 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-03-tritan.jpg) |
| 물랭 루주에서 | protan | 51.24% | 30.33% | 9.605 | 0.722 | 3.266 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-04-protan.jpg) |
| 물랭 루주에서 | deutan | 71.67% | 30.00% | 5.713 | 0.616 | 2.681 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-04-deutan.jpg) |
| 물랭 루주에서 | tritan | 10.66% | 10.16% | 8.348 | 0.243 | 1.964 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-04-tritan.jpg) |
| 수련 | protan | 56.98% | 0.87% | 3.496 | 0.146 | 3.714 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-05-protan.jpg) |
| 수련 | deutan | 65.09% | 4.55% | 3.181 | 0.198 | 7.138 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-05-deutan.jpg) |
| 수련 | tritan | 81.03% | 34.42% | 10.674 | 2.421 | 3.427 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-05-tritan.jpg) |
| 개풍쾌청 (붉은 후지산) | protan | 20.56% | 60.32% | 6.974 | 0.849 | 2.349 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-06-protan.jpg) |
| 개풍쾌청 (붉은 후지산) | deutan | 0.00% | 15.22% | 3.089 | 0.063 | 2.709 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-06-deutan.jpg) |
| 개풍쾌청 (붉은 후지산) | tritan | 88.97% | 8.09% | 7.889 | 0.041 | 1.660 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-06-tritan.jpg) |
| 아타케 신오하시 다리 위의 소나기 | protan | 15.04% | 87.03% | 3.302 | 0.803 | 4.129 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-07-protan.jpg) |
| 아타케 신오하시 다리 위의 소나기 | deutan | 11.93% | 87.24% | 1.971 | 0.431 | 3.566 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-07-deutan.jpg) |
| 아타케 신오하시 다리 위의 소나기 | tritan | 70.18% | 0.00% | 7.141 | 0.000 | 1.049 | [보기](../../../Backend/data/eval/palette-v1/panels/aic-07-tritan.jpg) |
| 프로방스의 농가 | protan | 83.00% | 34.93% | 12.766 | 2.429 | 6.493 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-01-protan.jpg) |
| 프로방스의 농가 | deutan | 73.61% | 34.23% | 10.369 | 1.958 | 6.787 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-01-deutan.jpg) |
| 프로방스의 농가 | tritan | 18.23% | 45.84% | 17.951 | 2.747 | 3.448 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-01-tritan.jpg) |
| 장미 | protan | 93.57% | 22.12% | 13.171 | 1.091 | 3.494 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-02-protan.jpg) |
| 장미 | deutan | 93.05% | 23.96% | 13.922 | 1.115 | 3.583 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-02-deutan.jpg) |
| 장미 | tritan | 65.27% | 7.41% | 17.447 | 0.480 | 2.508 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-02-tritan.jpg) |
| 물뿌리개를 든 소녀 | protan | 87.16% | 19.46% | 10.517 | 2.490 | 4.869 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-03-protan.jpg) |
| 물뿌리개를 든 소녀 | deutan | 85.82% | 25.09% | 10.078 | 1.198 | 4.633 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-03-deutan.jpg) |
| 물뿌리개를 든 소녀 | tritan | 60.41% | 35.56% | 11.992 | 3.207 | 3.118 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-03-tritan.jpg) |
| 양산을 쓴 여인 - 모네 부인과 아들 | protan | 87.37% | 12.29% | 2.904 | 0.231 | 4.122 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-04-protan.jpg) |
| 양산을 쓴 여인 - 모네 부인과 아들 | deutan | 89.29% | 11.69% | 3.215 | 0.260 | 6.476 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-04-deutan.jpg) |
| 양산을 쓴 여인 - 모네 부인과 아들 | tritan | 47.01% | 39.15% | 10.488 | 2.558 | 5.532 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-04-tritan.jpg) |
| 흰색 교향곡 1번: 하얀 옷을 입은 소녀 | protan | 43.37% | 9.64% | 0.562 | 0.277 | 3.220 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-05-protan.jpg) |
| 흰색 교향곡 1번: 하얀 옷을 입은 소녀 | deutan | 42.35% | 45.88% | 0.387 | 0.205 | 3.914 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-05-deutan.jpg) |
| 흰색 교향곡 1번: 하얀 옷을 입은 소녀 | tritan | 78.12% | 0.00% | 9.580 | 0.000 | 0.875 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-05-tritan.jpg) |
| 저울을 든 여인 | protan | 75.00% | 0.00% | 0.167 | 0.000 | 2.259 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-06-protan.jpg) |
| 저울을 든 여인 | deutan | 해당 쌍 없음 | 해당 쌍 없음 | 0.123 | 0.000 | 1.780 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-06-deutan.jpg) |
| 저울을 든 여인 | tritan | 1.03% | 5.15% | 3.806 | 0.061 | 4.303 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-06-tritan.jpg) |
| 두 도둑 사이에 못 박힌 그리스도 (세 개의 십자가) | protan | 해당 쌍 없음 | 해당 쌍 없음 | 0.012 | 0.000 | 1.393 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-07-protan.jpg) |
| 두 도둑 사이에 못 박힌 그리스도 (세 개의 십자가) | deutan | 해당 쌍 없음 | 해당 쌍 없음 | 0.012 | 0.000 | 2.171 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-07-deutan.jpg) |
| 두 도둑 사이에 못 박힌 그리스도 (세 개의 십자가) | tritan | 해당 쌍 없음 | 해당 쌍 없음 | 5.348 | 0.000 | 0.857 | [보기](../../../Backend/data/eval/palette-v1/panels/nga-07-tritan.jpg) |

## 시각 점검과 테스트

- 작품 63개 비교판을 [적색약 전체 보기](../../../Backend/data/eval/palette-v1/panels/overview-protan.jpg),
  [녹색약 전체 보기](../../../Backend/data/eval/palette-v1/panels/overview-deutan.jpg),
  [청색약 전체 보기](../../../Backend/data/eval/palette-v1/panels/overview-tritan.jpg)로 축소 점검했다.
- 별도로 밀밭/녹색약, 침실/청색약, 프로방스 농가/적색약, 거대한 파도/청색약,
  그랑드 자트/녹색약, 저울을 든 여인/녹색약의 900px 비교판과
  세 유형의 첫 검사판(보정 세기 1.0) 비교판을 열어 확인했다.
- 확인한 비교판 크기에서는 뚜렷한 군집 경계 띠나 큰 인공 얼룩을 발견하지 못했다.
  모든 원본 픽셀의 확대 검사까지 한 것은 아니다. B가 원본에 가까운 대신
  Brettel 시각에서 꽃/숫자의 차이를 충분히 회복하지 못하는 사례가 보였다.
- 기존 색 보정·검사판 테스트 23개와 새 실험·수치 미분·평가 판정 테스트 12개,
  총 35개 통과. 편집한 Python 파일의 편집기 진단 오류 없음.

## 발표 대본 예시 (3문장)

“그림마다 k-means 비지도 군집화로 정답표 없이 대표색을 약 12개 찾았습니다.
Machado 색각이상 시뮬레이션에서 헷갈리는 대표색을 찾아, 원래 색의 변화와 새로운 색 충돌을 줄이면서 색을 조정하는 최적화를 실험했습니다.
다른 시뮬레이션 모델로 검증한 결과 이번 설정은 기존 보정의 성능을 넘지 못해 향후 과제로 남겼습니다.”

이 대본은 **추가 실험 B**를 설명한다. 기존 A'로 만든 보정 사진을 B의 결과로 소개하지 않는다.

## 해석과 한계

- k-means는 그림의 대표색을 찾고, 최적화가 색 변경을 정했다. 최적화 목적값 감소와 독립 모델의 회복률 상승은 별개다.
- 대표색 쌍을 개선해도 픽셀의 부드러운 혼합 과정에서 효과가 약해지거나 새로운 충돌이 생길 수 있다.
- 평균 색 변화가 작아도 일부 색은 크게 바뀔 수 있고, 숫자 판의 평균색 차이는 시각적 가독성 전체를 나타내지 않는다.
- 네 평가 설정은 원뿔 투영 이론을 공유한다. Vischeck는 CRT 기반 비교 설정이며 HPE는 원래 색순응용 변환이다.
- Viénot 1999의 청색약 결과는 부정확한 스트레스 비교다. HPE/Vischeck 결과까지 넣는 엄격한 계획을 유지했다.
- 원본 검사판도 Machado가 지우는 방향으로 만들어져 있어, 다른 모델로 재더라도 데이터 생성 단계의 편향이 남는다.
- 실제 색각이상 사용자 평가, 다른 작품 검증, 혼합 색각 유형, 세기별 실제 사용자 관찰은 하지 않았다.
- 기존 앱과 서버의 보정 동작에는 이 실험을 연결하지 않았다.

## 재현과 원자료

저장소 루트에서 다음을 실행한다. 출력 폴더는 새 경로여야 한다.

```powershell
.\Backend\.venv\Scripts\python.exe -m Backend.ai.palette_experiment --out Backend/data/eval/palette-v1-reproduction --report Backend/data/eval/palette-v1-reproduction/report.md
```

- [전체 원자료 JSON](../../../Backend/data/eval/palette-v1/results.json) / [작품별 CSV](../../../Backend/data/eval/palette-v1/artworks.csv) / [검사판 CSV](../../../Backend/data/eval/palette-v1/plates.csv)
- [비교 그림 폴더](../../../Backend/data/eval/palette-v1/panels) / [검사판 원본·점 좌표](../../../Backend/data/eval/palette-v1/plates)
- 계획 SHA-256: `d44a90bf79e5dbda5be16cc70759c16b6f81f24e790d8d3376eea97868f37a7a`
- 코드·원본 이미지 해시는 JSON에 기록했다. 지표는 JPEG 저장 전 float32 배열로 계산했다.

참고: [DaltonLens 모델 구현](https://github.com/DaltonLens/DaltonLens-Python/blob/master/daltonlens/simulate.py),
[원뿔 변환과 비교 모델의 한계](https://github.com/DaltonLens/DaltonLens-Python/blob/master/daltonlens/convert.py).
