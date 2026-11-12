/**
 * 대비·밝기 보정용 Skia RuntimeShader (이미지 필터). 서버 `Backend/ai/correction.py`의 apply_contrast와 같은 식이다.
 *
 * 예전에는 회색 0.5를 기준으로 직선으로 대비를 키워서(rgb * c + 0.5 * (1 - c)), 대부분 0.5보다 어두운 그림은
 * 통째로 더 어두워지다 0에서 잘려 검게 뭉개졌다. 지금은
 * - 시그모이드 대비(ImageMagick sigmoidal-contrast와 같은 곡선): 검정은 검정, 흰색은 흰색으로 남고 중간에서 잘리지 않는다.
 * - 곡선의 중심 = 그림의 평균 밝기가 바뀌지 않는 점: 그림의 밝기 분포(32칸 히스토그램)로 찾는다.
 *   그래서 어두운 그림은 어두운 범위 안에서, 밝은 그림은 밝은 범위 안에서 대비가 커진다.
 * - 밝기(luma)에만 적용하고 색은 밝기 비율로 따라가게 해 색이 틀어지지 않는다.
 * 대비 c는 곡선 중심에서의 기울기다(c = 2면 중간 밝기의 차이가 2배). c < 1이면 역곡선으로 대비를 낮춘다.
 */

import { AlphaType, ColorType, Skia, type SkImage, type SkRuntimeEffect } from '@shopify/react-native-skia';

export const TONE_BINS = 32;

const SKSL = `
uniform shader image;
uniform float mode;
uniform float gain;
uniform float mid;
uniform float low;
uniform float high;
uniform float brightness;

float sigmoid(float x) { return 1.0 / (1.0 + exp(-x)); }

half4 main(float2 xy) {
  half4 pixel = image.eval(xy);
  if (pixel.a <= 0.0) return pixel;
  float3 rgb = float3(pixel.rgb) / float(pixel.a);
  float y = dot(rgb, float3(0.2126, 0.7152, 0.0722));
  float z = y;
  if (mode > 0.5) {
    z = (sigmoid(gain * (y - mid)) - low) / (high - low);
  } else if (mode < -0.5) {
    float t = clamp(y * (high - low) + low, 0.00001, 0.99999);
    z = clamp(mid + log(t / (1.0 - t)) / gain, 0.0, 1.0);
  }
  float3 toned = y > 0.0001 ? rgb * (z / y) : float3(z);
  toned = clamp(toned + brightness, 0.0, 1.0);
  return half4(half3(toned) * pixel.a, pixel.a);
}
`;

export type ToneUniforms = { mode: number; gain: number; mid: number; low: number; high: number; brightness: number };

function sigmoid(x: number) {
  'worklet';
  return 1 / (1 + Math.exp(-x));
}

/** 중심(mid)에서 곡선의 기울기가 contrast(>1)가 되는 시그모이드 세기. */
export function sigmoidGain(contrast: number, mid: number) {
  'worklet';
  if (contrast <= 1) return 0;
  let low = 1e-4;
  let high = 60;
  for (let i = 0; i < 50; i++) {
    const gain = (low + high) / 2;
    const slope = (gain * 0.25) / (sigmoid(gain * (1 - mid)) - sigmoid(-gain * mid));
    if (slope < contrast) low = gain;
    else high = gain;
  }
  return (low + high) / 2;
}

/** 정규화 시그모이드 대비 곡선 (0 → 0, 1 → 1). */
export function toneCurve(y: number, contrast: number, mid: number) {
  'worklet';
  if (Math.abs(contrast - 1) < 1e-4) return y;
  const gain = sigmoidGain(contrast > 1 ? contrast : 1 / contrast, mid);
  const low = sigmoid(-gain * mid);
  const high = sigmoid(gain * (1 - mid));
  if (contrast > 1) return (sigmoid(gain * (y - mid)) - low) / (high - low);
  const t = Math.min(1 - 1e-6, Math.max(1e-6, y * (high - low) + low));
  return Math.min(1, Math.max(0, mid + Math.log(t / (1 - t)) / gain));
}

/** 대비를 바꿔도 그림의 평균 밝기가 그대로인 곡선 중심. histogram이 없으면 0.5. */
export function toneMid(histogram: number[] | null, contrast: number) {
  'worklet';
  if (!histogram || histogram.length === 0) return 0.5;
  let total = 0;
  for (const count of histogram) total += count;
  if (total <= 0) return 0.5;
  const n = histogram.length;
  let target = 0;
  for (let i = 0; i < n; i++) target += (histogram[i] / total) * ((i + 0.5) / n);
  let low = 0.02;
  let high = 0.98;
  for (let step = 0; step < 30; step++) {
    const mid = (low + high) / 2;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += (histogram[i] / total) * toneCurve((i + 0.5) / n, contrast, mid);
    if (mean > target === contrast > 1) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * 셰이더에 넘길 값. contrast(0.5~2)·brightness(-1~1)는 프로필 값, strength(0~1)는 적용 비율.
 * UI 스레드에서 슬라이더를 끌 때마다 다시 계산해도 될 만큼 가볍다(32칸 × 30회 탐색).
 */
export function toneUniforms(contrast: number, brightness: number, strength: number, histogram: number[] | null): ToneUniforms {
  'worklet';
  const c = 1 + (contrast - 1) * strength;
  const shift = brightness * strength;
  if (!Number.isFinite(c) || Math.abs(c - 1) < 1e-4) return { mode: 0, gain: 1, mid: 0.5, low: 0, high: 1, brightness: shift };
  const mid = toneMid(histogram, c);
  const gain = sigmoidGain(c > 1 ? c : 1 / c, mid);
  return { mode: c > 1 ? 1 : -1, gain, mid, low: sigmoid(-gain * mid), high: sigmoid(gain * (1 - mid)), brightness: shift };
}

/** 그림을 32×32로 줄여 밝기(luma) 히스토그램을 만든다. 만들 수 없으면 null(곡선 중심 0.5로 대신함). */
export function lumaHistogram(image: SkImage, size = 32): number[] | null {
  try {
    const surface = Skia.Surface.Make(size, size);
    if (!surface) return null;
    const paint = Skia.Paint();
    surface.getCanvas().drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, size, size),
      paint,
    );
    surface.flush();
    // 기기마다 기본 픽셀 순서(RGBA/BGRA)가 달라 RGBA로 정해서 읽는다.
    const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
      width: size, height: size, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
    });
    if (!pixels) return null;
    const scale = pixels instanceof Float32Array ? 1 : 1 / 255;
    const histogram = new Array<number>(TONE_BINS).fill(0);
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      const y = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * scale;
      histogram[Math.min(TONE_BINS - 1, Math.max(0, Math.floor(y * TONE_BINS)))] += 1;
    }
    return histogram;
  } catch {
    return null;
  }
}

let cached: SkRuntimeEffect | null | undefined;

/** 처음 쓸 때 컴파일한다. 만들 수 없으면 null을 돌려주고, 쓰는 쪽은 예전 색 행렬(ColorMatrix)로 그린다. */
export function getToneEffect(): SkRuntimeEffect | null {
  if (cached === undefined) {
    try {
      cached = Skia.RuntimeEffect.Make(SKSL);
    } catch {
      cached = null;
    }
    if (!cached) console.warn('대비 셰이더를 만들 수 없어 기본 대비로 그립니다');
  }
  return cached;
}

export const TONE_SHADER = SKSL;
