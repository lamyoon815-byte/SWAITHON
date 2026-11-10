// 자동 생성 파일: Backend/ai/calibration_assets.py 가 만든다. 직접 고치지 말고 스크립트를 다시 실행하세요.
// 규칙 설명: docs/ai-calibration.md

export type CalibrationColorType = 'normal' | 'protan' | 'deutan' | 'tritan';
export type CalibrationPlate = { answer: string; choices: string[]; image: number };

export const CALIBRATION_NOT_VISIBLE = "숫자가 안 보여요";

export const CALIBRATION = {
  /** 1단계: 보정 없는 검사판 3장. 어느 판의 숫자를 못 맞혔는지로 color_type을 정한다 */
  screening: {
    question: "그림 속 숫자가 보이면 골라 주세요.",
    plates: [
      { color_type: 'protan', answer: "45", choices: ["97", "45", "71", "숫자가 안 보여요"], image: require('./plate-protan-45-0.jpg') },
      { color_type: 'deutan', answer: "29", choices: ["34", "76", "29", "숫자가 안 보여요"], image: require('./plate-deutan-29-0.jpg') },
      { color_type: 'tritan', answer: "73", choices: ["73", "28", "81", "숫자가 안 보여요"], image: require('./plate-tritan-73-0.jpg') },
    ] as ({ color_type: Exclude<CalibrationColorType, 'normal'> } & CalibrationPlate)[],
  },
  /** 2단계: 색 보정 세기. plates[i]는 levels[i](= AIProfile.severity)로 보정한 검사판. 숫자를 맞히면 멈춘다 */
  color: {
    question: "그림 속 숫자가 보이면 골라 주세요.",
    protan: { levels: [0.2, 0.4, 0.6, 0.8, 1.0], plates: [
      { answer: "86", choices: ["79", "25", "86", "숫자가 안 보여요"], image: require('./plate-protan-86-20.jpg') },
      { answer: "32", choices: ["95", "86", "32", "숫자가 안 보여요"], image: require('./plate-protan-32-40.jpg') },
      { answer: "57", choices: ["39", "29", "57", "숫자가 안 보여요"], image: require('./plate-protan-57-60.jpg') },
      { answer: "94", choices: ["32", "94", "25", "숫자가 안 보여요"], image: require('./plate-protan-94-80.jpg') },
      { answer: "28", choices: ["97", "28", "69", "숫자가 안 보여요"], image: require('./plate-protan-28-100.jpg') },
    ] },
    deutan: { levels: [0.2, 0.4, 0.6, 0.8, 1.0], plates: [
      { answer: "74", choices: ["95", "39", "74", "숫자가 안 보여요"], image: require('./plate-deutan-74-20.jpg') },
      { answer: "63", choices: ["63", "58", "57", "숫자가 안 보여요"], image: require('./plate-deutan-63-40.jpg') },
      { answer: "85", choices: ["85", "49", "41", "숫자가 안 보여요"], image: require('./plate-deutan-85-60.jpg') },
      { answer: "42", choices: ["42", "63", "51", "숫자가 안 보여요"], image: require('./plate-deutan-42-80.jpg') },
      { answer: "96", choices: ["31", "96", "75", "숫자가 안 보여요"], image: require('./plate-deutan-96-100.jpg') },
    ] },
    tritan: { levels: [0.2, 0.4, 0.6, 0.8, 1.0], plates: [
      { answer: "38", choices: ["72", "29", "38", "숫자가 안 보여요"], image: require('./plate-tritan-38-20.jpg') },
      { answer: "52", choices: ["52", "93", "39", "숫자가 안 보여요"], image: require('./plate-tritan-52-40.jpg') },
      { answer: "69", choices: ["28", "69", "52", "숫자가 안 보여요"], image: require('./plate-tritan-69-60.jpg') },
      { answer: "24", choices: ["24", "73", "86", "숫자가 안 보여요"], image: require('./plate-tritan-24-80.jpg') },
      { answer: "87", choices: ["56", "87", "45", "숫자가 안 보여요"], image: require('./plate-tritan-87-100.jpg') },
    ] },
  } as { question: string } & Record<Exclude<CalibrationColorType, 'normal'>, { levels: number[]; plates: CalibrationPlate[] }>,
  /** 8-1 슬라이더 미리보기. plate[i]·artwork[i]가 levels[i]로 보정한 그림 (0번은 원본) */
  preview: {
    levels: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    protan: { plate: [require('./plate-protan-45-0.jpg'), require('./plate-protan-45-slider-20.jpg'), require('./plate-protan-45-slider-40.jpg'), require('./plate-protan-45-slider-60.jpg'), require('./plate-protan-45-slider-80.jpg'), require('./plate-protan-45-slider-100.jpg')],
      artwork: [require('./farmhouse-original.jpg'), require('./farmhouse-protan-20.jpg'), require('./farmhouse-protan-40.jpg'), require('./farmhouse-protan-60.jpg'), require('./farmhouse-protan-80.jpg'), require('./farmhouse-protan-100.jpg')] },
    deutan: { plate: [require('./plate-deutan-29-0.jpg'), require('./plate-deutan-29-slider-20.jpg'), require('./plate-deutan-29-slider-40.jpg'), require('./plate-deutan-29-slider-60.jpg'), require('./plate-deutan-29-slider-80.jpg'), require('./plate-deutan-29-slider-100.jpg')],
      artwork: [require('./farmhouse-original.jpg'), require('./farmhouse-deutan-20.jpg'), require('./farmhouse-deutan-40.jpg'), require('./farmhouse-deutan-60.jpg'), require('./farmhouse-deutan-80.jpg'), require('./farmhouse-deutan-100.jpg')] },
    tritan: { plate: [require('./plate-tritan-73-0.jpg'), require('./plate-tritan-73-slider-20.jpg'), require('./plate-tritan-73-slider-40.jpg'), require('./plate-tritan-73-slider-60.jpg'), require('./plate-tritan-73-slider-80.jpg'), require('./plate-tritan-73-slider-100.jpg')],
      artwork: [require('./bedroom-original.jpg'), require('./bedroom-tritan-20.jpg'), require('./bedroom-tritan-40.jpg'), require('./bedroom-tritan-60.jpg'), require('./bedroom-tritan-80.jpg'), require('./bedroom-tritan-100.jpg')] },
  },
  /** 3단계: 선 굵기. images[i]가 levels[i](= AIProfile.edge)로 보정한 그림 */
  edge: { question: "빗줄기와 다리 위 사람들이 또렷하게 보이나요?", levels: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0], images: [require('./shower-original.jpg'), require('./shower-edge-20.jpg'), require('./shower-edge-40.jpg'), require('./shower-edge-60.jpg'), require('./shower-edge-80.jpg'), require('./shower-edge-100.jpg')] },
  /** 4단계: 대비. 그림은 원본 하나이고 Skia contrast 값만 levels 순서로 바꾼다 */
  contrast: { question: "흰 옷과 뒤의 흰 커튼이 구분되나요?", levels: [1.0, 1.2, 1.4, 1.6, 1.8, 2.0], image: require('./symphony-original.jpg') },
};
