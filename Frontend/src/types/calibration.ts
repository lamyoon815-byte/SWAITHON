/** AI 보정 이름과 단위를 그대로 유지한다. 앱 밝기(-1~1)와 AI 밝기는 별개다. */
export type CalibrationColorType = 'normal' | 'protan' | 'deutan' | 'tritan';
export type ColorSeverities = Partial<Record<Exclude<CalibrationColorType, 'normal'>, number>>;

export type CalibrationSettings = {
  color_type: CalibrationColorType;
  /** 0~1, 0.2 간격 */
  severity: number;
  /** 종류별 0~1 강도. color_type은 현재 편집 중인 종류이며 normal이면 모두 끈다. */
  color_severities?: ColorSeverities;
  /** 윤곽선 강조 강도. px가 아니며 0~1, 0.2 간격 */
  edge: number;
};

export type CalibrationResult = CalibrationSettings & { contrast: number };

export const CALIBRATION_COLOR_LABELS: Record<CalibrationColorType, string> = {
  normal: '색 보정 없음', protan: '빨강 보정', deutan: '녹색 보정', tritan: '파랑 보정',
};

/** 예전 단일 종류 설정도 해당 종류의 값으로 그대로 읽는다. */
export function colorSeverities(settings: Pick<CalibrationSettings, 'color_type' | 'severity' | 'color_severities'>) {
  const values = settings.color_severities ?? (settings.color_type === 'normal' ? {} : { [settings.color_type]: settings.severity });
  const level = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;
  return { protan: level(values.protan), deutan: level(values.deutan), tritan: level(values.tritan) };
}

export function isCalibrationSettings(value: unknown): value is CalibrationSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as CalibrationSettings;
  const level = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  const colors = candidate.color_severities;
  return Object.hasOwn(CALIBRATION_COLOR_LABELS, candidate.color_type)
    && level(candidate.severity) && level(candidate.edge)
    && (candidate.color_type !== 'normal' || candidate.severity === 0)
    && (colors === undefined || (!!colors && typeof colors === 'object' && !Array.isArray(colors)
      && Object.entries(colors).every(([type, value]) => ['protan', 'deutan', 'tritan'].includes(type) && level(value))));
}
