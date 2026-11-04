import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { MinTouchTarget, type Palette } from '@/constants/a11y';
import { Colors } from '@/constants/theme';

type Props = {
  /** 스크린리더가 읽을 이름. 예: "작품 목록으로" */
  label: string;
  palette: Palette;
  scheme: 'light' | 'dark';
  onPress?: () => void;
};

/** 왼쪽 위의 둥근 뒤로 가기 버튼. 기본 동작은 `router.back()`. */
export function BackButton({ label, palette, scheme, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => router.back())}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: Colors[scheme].backgroundSelected, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.icon, { color: palette.text }]}>‹</Text>
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
  icon: {
    fontSize: 34,
    fontWeight: 700,
    lineHeight: 38,
    marginTop: -4,
  },
});
