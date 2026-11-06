import { Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';

type Props = {
  label: string;
  onPress: () => void;
  palette: Palette;
  selected?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  /** 스크린리더가 읽을 이름. `label`에 ✓ 같은 기호가 있으면 기호 없이 따로 준다 */
  accessibilityLabel?: string;
  /** 둘 중 하나를 고르는 묶음(보정본/원본 등) 안의 버튼이면 true. 스크린리더가 "선택됨"으로 읽는다 */
  radio?: boolean;
};

export function BigButton({
  label,
  onPress,
  palette,
  selected,
  disabled,
  accessibilityHint,
  accessibilityLabel,
  radio,
}: Props) {
  const filled = selected ?? true;
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={radio ? { checked: !!selected, disabled } : { selected, disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: filled ? palette.accent : palette.surface,
          borderColor: filled ? palette.accent : palette.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}>
      <Text style={[styles.label, { color: filled ? palette.accentText : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: MinTouchTarget,
    minWidth: MinTouchTarget,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  label: {
    fontSize: FontSize.button,
    fontWeight: 700,
    textAlign: 'center',
  },
});
