export type CorrectionField = 'contrast' | 'brightness' | 'sharpen';

export function correctionDisplayValue(field: CorrectionField, value: number) {
  return Math.round((field === 'contrast' ? value - 1 : value) * 100);
}

export function formatCorrection(field: CorrectionField, value: number) {
  const display = correctionDisplayValue(field, value);
  return display > 0 ? `+${display}` : `${display}`;
}
