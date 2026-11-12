import { CALIBRATION } from '@/assets/images/calibration';
import { colorSeverities, type CalibrationColorType } from '@/types/calibration';
import type { ViewingSettings, VisualProfile } from '@/types/profile';

export type CorrectionPreview = 'color' | 'edge';
const COLOR_TYPES: Record<VisualProfile['color_vision'], CalibrationColorType> = {
  normal: 'normal', protanopia: 'protan', deuteranopia: 'deutan', tritanopia: 'tritan',
};

export function correctionSettings(profile: VisualProfile): ViewingSettings {
  const color_type = profile.calibration?.color_type ?? COLOR_TYPES[profile.color_vision] ?? 'normal';
  const legacySeverity = Number.isFinite(profile.color_severity) ? profile.color_severity : 0;
  const severity = profile.calibration?.severity ?? Math.round(Math.min(1, Math.max(0, legacySeverity)) * 5) / 5;
  const color_severities = colorSeverities({ color_type, severity, color_severities: profile.calibration?.color_severities });
  return {
    color_type, severity: color_type === 'normal' ? 0 : color_severities[color_type], color_severities,
    edge: profile.calibration?.edge ?? 0,
    contrast: profile.contrast, brightness: profile.brightness, sharpen: profile.sharpen,
  };
}

export function correctionSettingsChanged(values: ViewingSettings, saved: ViewingSettings) {
  const colors = colorSeverities(values);
  const savedColors = colorSeverities(saved);
  return (Object.keys(saved) as (keyof ViewingSettings)[]).some((field) => field !== 'color_severities' && values[field] !== saved[field])
    || (Object.keys(colors) as (keyof typeof colors)[]).some((type) => colors[type] !== savedColors[type]);
}

/** 종류를 바꿔도 값을 지우지 않고, 슬라이더는 선택한 종류만 갱신한다. */
export function updateCorrectionSettings(values: ViewingSettings, patch: Partial<ViewingSettings>): ViewingSettings {
  const color_severities = colorSeverities(values);
  const color_type = patch.color_type ?? values.color_type;
  if (patch.severity !== undefined && color_type !== 'normal') color_severities[color_type] = patch.severity;
  return { ...values, ...patch, color_type, color_severities, severity: color_type === 'normal' ? 0 : color_severities[color_type] };
}

/** 선택한 편집 종류와 다른 보정값은 유지하고, 지정한 종류만 끈다. */
export function clearColorSeverity(values: ViewingSettings, type: Exclude<CalibrationColorType, 'normal'>): ViewingSettings {
  const color_severities = { ...colorSeverities(values), [type]: 0 };
  return { ...values, color_severities, severity: values.color_type === type ? 0 : values.severity };
}

/** 항목별 원본과 보정본은 같은 작품을 사용한다. 색·윤곽선 합성 결과는 아니다. */
export function correctionPreview(values: ViewingSettings, mode: CorrectionPreview, original: boolean) {
  if (mode === 'edge') return {
    artwork: CALIBRATION.edge.images[original ? 0 : Math.round(values.edge * 5)],
    label: '히로시게의 다리 위 소나기, 윤곽선 강조 미리보기',
  };
  const color = values.color_type === 'normal' ? 'deutan' : values.color_type;
  const index = original || values.color_type === 'normal' ? 0 : Math.round(values.severity * 5);
  return {
    artwork: CALIBRATION.preview[color].artwork[index],
    plate: CALIBRATION.preview[color].plate[index],
    label: color === 'tritan' ? '반 고흐의 침실, 색 보정 미리보기' : '반 고흐의 프로방스의 농가, 색 보정 미리보기',
  };
}
