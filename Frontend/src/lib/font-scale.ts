import type { TextStyle } from 'react-native';

import { FontSize } from '@/constants/a11y';

export const FONT_SCALE = { normal: 1, large: 1.2, xlarge: 1.4 } as const;

export function getFontScale(value: string): number {
  return Object.hasOwn(FONT_SCALE, value) ? FONT_SCALE[value as keyof typeof FONT_SCALE] : 1;
}

/** 중첩 텍스트는 상속된 크기를 다시 배율 계산하지 않는다. 시스템 배율은 RN이 추가 적용한다. */
export function scaleTextStyle(style: TextStyle | null | undefined, scale: number, nested = false): TextStyle {
  const size = style?.fontSize ?? (nested ? undefined : FontSize.body);
  return {
    ...(size !== undefined ? { fontSize: Math.round(size * scale * 100) / 100 } : {}),
    ...(typeof style?.lineHeight === 'number' ? { lineHeight: Math.round(style.lineHeight * scale * 100) / 100 } : {}),
  };
}
