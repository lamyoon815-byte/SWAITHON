import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { MinTouchTarget, type Palette } from '@/constants/a11y';

type Props = {
  /** 스크린리더가 읽을 이름. 예: "작품 목록으로" */
  label: string;
  palette: Palette;
  onPress?: () => void;
};

/** 왼쪽 위의 둥근 뒤로 가기 버튼. 기본 동작은 `router.back()`. */
export function BackButton({ label, palette, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => router.back())}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.fill, opacity: pressed ? 0.7 : 1 },
      ]}>
      {/* An icon, not a "‹" glyph: glyphs change shape with the font and grow with system text size. */}
      <SymbolView
        name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
        size={26}
        weight="bold"
        tintColor={palette.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
