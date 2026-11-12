import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import type { ColorSeverities } from '@/types/calibration';
import matrices from './color-correction-matrices.json';

// I + ERROR_SHIFT × (I - MACHADO_2009), from Backend/ai/correction.py.
// This preview applies protan/deutan to the whole picture. The server applies them only to confusable
// colours and boundaries (correction.confusion_weight), so the server result changes other colours less.
// Each stage uses the same linear RGB conversion and clipping as the server.
export const COLOR_CORRECTION_SHADER = `
uniform shader image;
uniform float3 active;
uniform float contrast;
uniform float brightness;
uniform float3 protanR; uniform float3 protanG; uniform float3 protanB;
uniform float3 deutanR; uniform float3 deutanG; uniform float3 deutanB;
uniform float3 tritanR; uniform float3 tritanG; uniform float3 tritanB;

float toLinear(float c) {
  c = floor(clamp(c, 0.0, 1.0) * 4095.0 + 0.5) / 4095.0;
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float toSrgb(float c) {
  c = floor(clamp(c, 0.0, 1.0) * 4095.0 + 0.5) / 4095.0;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
float3 correct(float3 rgb, float3 r, float3 g, float3 b) {
  float3 linear = float3(toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b));
  float3 corrected = float3(dot(r, linear), dot(g, linear), dot(b, linear));
  return float3(toSrgb(corrected.r), toSrgb(corrected.g), toSrgb(corrected.b));
}
half4 main(float2 xy) {
  half4 pixel = image.eval(xy);
  if (pixel.a <= 0.0) return pixel;
  float3 rgb = float3(pixel.rgb) / float(pixel.a);
  if (active.x > 0.0) rgb = correct(rgb, protanR, protanG, protanB);
  if (active.y > 0.0) rgb = correct(rgb, deutanR, deutanG, deutanB);
  if (active.z > 0.0) rgb = correct(rgb, tritanR, tritanG, tritanB);
  rgb = clamp(rgb * contrast + 0.5 * (1.0 - contrast) + brightness, 0.0, 1.0);
  return half4(half3(rgb) * pixel.a, pixel.a);
}
`;

export function colorCorrectionUniforms(values: ColorSeverities, contrast = 1, brightness = 0) {
  const uniforms: Record<string, number[]> = { active: [], contrast: [contrast], brightness: [brightness] };
  for (const color of ['protan', 'deutan', 'tritan'] as const) {
    const value = values[color] ?? 0;
    const position = (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0) * 10;
    const low = Math.floor(position);
    const high = Math.min(10, low + 1);
    const weight = position - low;
    const matrix = matrices[color][low].map((value, i) => value * (1 - weight) + matrices[color][high][i] * weight);
    uniforms.active.push(position > 0 ? 1 : 0);
    for (const [i, row] of ['R', 'G', 'B'].entries()) uniforms[`${color}${row}`] = matrix.slice(i * 3, i * 3 + 3);
  }
  return uniforms;
}

let cached: SkRuntimeEffect | null | undefined;

export function getColorCorrectionEffect(): SkRuntimeEffect | null {
  if (cached === undefined) {
    try { cached = Skia.RuntimeEffect.Make(COLOR_CORRECTION_SHADER); }
    catch { cached = null; }
  }
  return cached;
}
