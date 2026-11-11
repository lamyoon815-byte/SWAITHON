import { StyleSheet } from 'react-native';

import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';
import { ButtonRadius, FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';

type Props = {
  label: string;
  onPress: () => void;
  palette: Palette;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/**
 * 테두리·배경 없는 글자 버튼. 주 버튼 아래에 두는 "건너뛰기"처럼 덜 중요한 동작에 쓴다.
 * 모양은 가볍지만 터치 영역은 주 버튼과 같은 높이(56)로 둬서 누르기 쉽다. 누르면 배경이 살짝 생긴다.
 */
export function TextButton({ label, onPress, palette, disabled, accessibilityLabel, accessibilityHint }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: pressed ? palette.fill : 'transparent', opacity: disabled ? 0.4 : 1 }]}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: MinTouchTarget, borderRadius: ButtonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  label: { fontSize: FontSize.label, fontWeight: 700, textAlign: 'center', textDecorationLine: 'underline' },
});
