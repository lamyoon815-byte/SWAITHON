import { CALIBRATION } from '@/assets/images/calibration';
import type { CalibrationColorType } from '@/types/calibration';
import type { ViewingSettings, VisualProfile } from '@/types/profile';

export type CorrectionPreview = 'color' | 'edge';
const COLOR_TYPES: Record<VisualProfile['color_vision'], CalibrationColorType> = {
  normal: 'normal', protanopia: 'protan', deuteranopia: 'deutan', tritanopia: 'tritan',
};

export function correctionSettings(profile: VisualProfile): ViewingSettings {
  const color_type = profile.calibration?.color_type ?? COLOR_TYPES[profile.color_vision] ?? 'normal';
  const legacySeverity = Number.isFinite(profile.color_severity) ? profile.color_severity : 0;
  const severity = profile.calibration?.severity ?? Math.round(Math.min(1, Math.max(0, legacySeverity)) * 5) / 5;
  return {
    color_type, severity: color_type === 'normal' ? 0 : severity,
    edge: profile.calibration?.edge ?? 0,
    contrast: profile.contrast, brightness: profile.brightness, sharpen: profile.sharpen,
  };
}

export function correctionSettingsChanged(values: ViewingSettings, saved: ViewingSettings) {
  return (Object.keys(saved) as (keyof ViewingSettings)[]).some((field) => values[field] !== saved[field]);
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
