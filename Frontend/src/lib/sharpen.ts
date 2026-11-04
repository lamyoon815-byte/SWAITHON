/**
 * 샤프닝용 Skia RuntimeShader (이미지 필터).
 * 3×3 라플라시안 언샤프 마스크: c + amount * (4c - 상하좌우 이웃 합). amount 0이면 원본과 같다.
 */

import { Skia } from '@shopify/react-native-skia';

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

const effect = Skia.RuntimeEffect.Make(SKSL);
if (!effect) throw new Error('샤프닝 셰이더 컴파일 실패');

export const sharpenEffect = effect;
