/**
 * 샤프닝용 Skia RuntimeShader (이미지 필터).
 * 3×3 라플라시안 언샤프 마스크: c + amount * (4c - 상하좌우 이웃 합). amount 0이면 원본과 같다.
 */

import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

const SKSL = `
uniform shader image;
uniform float amount;

half4 main(float2 xy) {
  half4 c = image.eval(xy);
  half4 n = image.eval(xy + float2(1, 0)) + image.eval(xy - float2(1, 0))
          + image.eval(xy + float2(0, 1)) + image.eval(xy - float2(0, 1));
  half3 rgb = c.rgb + half(amount) * (4.0 * c.rgb - n.rgb);
  return half4(clamp(rgb, half3(0), half3(c.a)), c.a);
}
`;

let cached: SkRuntimeEffect | null | undefined;

/**
 * 처음 쓸 때 컴파일한다. 파일을 불러오는 순간 만들면 Skia가 없는 환경(웹 서버 렌더링)에서
 * 앱 전체가 멈춘다. 만들 수 없으면 null을 돌려주고, 쓰는 쪽은 샤프닝 없이 그린다.
 */
export function getSharpenEffect(): SkRuntimeEffect | null {
  if (cached === undefined) {
    try {
      cached = Skia.RuntimeEffect.Make(SKSL);
    } catch {
      cached = null;
    }
    if (!cached) console.warn('샤프닝 셰이더를 만들 수 없어 선명도 보정 없이 그립니다');
  }
  return cached;
}
