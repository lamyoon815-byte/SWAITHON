/**
 * 4x5 color matrices for Skia's <ColorMatrix>. Translate column is normalized (0..1).
 */

export const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/**
 * @param contrast 1 = unchanged, >1 more contrast (pivot at mid-gray)
 * @param brightness 0 = unchanged, additive in -1..1
 * @param strength 0 = original, 1 = full correction
 */
export function correctionMatrix(contrast: number, brightness: number, strength: number) {
  'worklet';
  const c = 1 + (contrast - 1) * strength;
  const t = 0.5 * (1 - c) + brightness * strength;
  return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0];
}
