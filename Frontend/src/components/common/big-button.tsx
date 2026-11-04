import { Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';

type Props = {
  label: string;
  onPress: () => void;
  palette: Palette;
  selected?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

export function BigButton({ label, onPress, palette, selected, disabled, accessibilityHint }: Props) {
  const filled = selected ?? true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
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
