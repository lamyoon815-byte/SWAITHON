import type { VisualProfile } from '@/types/profile';
export type ColorType = 'normal' | 'protan' | 'deutan' | 'tritan';
export type ViewingProfile = {
  color_type: ColorType;
  severity: number;
  edge: number;
  contrast: number;
  /** App/Skia unit; never sent to /correction. */
  brightness: number;
  sharpness: number;
  revision?: string;
};

export const DEFAULT_VIEWING: ViewingProfile = {
  color_type: 'normal', severity: 0, edge: 0, contrast: 1, brightness: 0, sharpness: 0,
};
export const COLOR_LABELS: Record<ColorType, string> = {
  normal: '없음', protan: '적색약', deutan: '녹색약', tritan: '청색약',
};

/** null means the user must choose; mixed blue/red-green failures are ambiguous. */
export function screeningColor(failed: Exclude<ColorType, 'normal'>[]): ColorType | null {
  const unique = new Set(failed);
  if (unique.has('tritan') && unique.size >= 2) return null;
  if (unique.has('tritan')) return 'tritan';
  if (unique.has('deutan')) return 'deutan';
  if (unique.has('protan')) return 'protan';
  return 'normal';
}

/** Server handles only color/edge. Skia applies brightness, contrast and sharpness once. */
export function serverCorrection(profile: ViewingProfile, strength = 1) {
  strength = correctionStrength(strength);
  return {
    color_type: profile.color_type,
    severity: profile.color_type === 'normal' ? 0 : profile.severity * strength,
    edge: profile.edge * strength,
    contrast: 1, brightness: 0, sharpness: 0,
  };
}

/** 작품 슬라이더와 URL 모두 저장된 개인 보정값의 0~100% 안에서만 조절한다. */
export function correctionStrength(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function normalizeViewing(value: Partial<ViewingProfile>): ViewingProfile {
  const clamp = (n: number | undefined, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  const color_type = Object.hasOwn(COLOR_LABELS, value.color_type ?? '') ? value.color_type! : 'normal';
  return {
    color_type,
    severity: color_type === 'normal' ? 0 : clamp(value.severity, 0, 1, 0),
    edge: clamp(value.edge, 0, 1, 0), contrast: clamp(value.contrast, 0.5, 2, 1),
    brightness: clamp(value.brightness, -1, 1, 0), sharpness: clamp(value.sharpness, 0, 2, 0),
  };
}


/** Shared device profile, including a past viewing record, to the AI correction contract. */
export function viewingFromProfile(profile: VisualProfile): ViewingProfile {
  const legacyColor = { normal: 'normal', protanopia: 'protan', deuteranopia: 'deutan', tritanopia: 'tritan' } as const;
  return { ...normalizeViewing({
    color_type: profile.calibration?.color_type ?? legacyColor[profile.color_vision],
    severity: profile.calibration?.severity ?? profile.color_severity,
    edge: profile.calibration?.edge ?? 0,
    contrast: profile.contrast, brightness: profile.brightness, sharpness: profile.sharpen,
  }), revision: profile.revision };
}
