/** AI 보정 이름과 단위를 그대로 유지한다. 앱 밝기(-1~1)와 AI 밝기는 별개다. */
export type CalibrationColorType = 'normal' | 'protan' | 'deutan' | 'tritan';

export type CalibrationSettings = {
  color_type: CalibrationColorType;
  /** 0~1, 0.2 간격 */
  severity: number;
  /** 윤곽선 강조 강도. px가 아니며 0~1, 0.2 간격 */
  edge: number;
};

export type CalibrationResult = CalibrationSettings & { contrast: number };

export const CALIBRATION_COLOR_LABELS: Record<CalibrationColorType, string> = {
  normal: '색 보정 없음', protan: '빨강 보정', deutan: '녹색 보정', tritan: '파랑 보정',
};

export function isCalibrationSettings(value: unknown): value is CalibrationSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as CalibrationSettings;
  const level = (v: number) => Number.isFinite(v) && [0, 0.2, 0.4, 0.6, 0.8, 1].includes(v);
  return Object.hasOwn(CALIBRATION_COLOR_LABELS, candidate.color_type)
    && level(candidate.severity) && level(candidate.edge)
    && (candidate.color_type !== 'normal' || candidate.severity === 0);
}
