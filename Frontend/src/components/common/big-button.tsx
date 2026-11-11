import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';

import {
  ButtonHeight,
  ButtonRadius,
  FontSize,
  MinTouchTarget,
  type Palette,
} from '@/constants/a11y';

const CheckSize = 22;

type Props = {
  label: string;
  onPress: () => void;
  palette: Palette;
  selected?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  /** 스크린리더가 읽을 이름. 기본은 `label` */
  accessibilityLabel?: string;
  /**
   * 둘 중 하나를 고르는 묶음(보정본/원본 등) 안의 버튼이면 true. 스크린리더가 "선택됨"으로 읽고,
   * 선택되면 글자 앞에 ✓ 아이콘이 보인다. `label`에는 ✓를 넣지 않는다.
   */
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
  const color = filled ? palette.accentText : palette.text;
  return (
    <PressableScale
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
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
      {/*
        Radio buttons always reserve the ✓ slot and an equal empty slot on the other side, so
        selecting only fades the ✓ in: the label never moves and stays centered.
      */}
      {radio && (
        <View style={[styles.slot, { opacity: selected ? 1 : 0 }]}>
          <SymbolView
            name={{ ios: 'checkmark', android: 'check', web: 'check' }}
            size={CheckSize}
            weight="bold"
            tintColor={color}
          />
        </View>
      )}
      <Text style={[styles.label, { color }]}>{label}</Text>
      {radio && <View style={styles.slot} />}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: ButtonHeight,
    minWidth: MinTouchTarget,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: ButtonRadius,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexGrow: 1,
  },
  slot: {
    width: CheckSize,
    alignItems: 'center',
  },
  label: {
    flexShrink: 1,
    fontSize: FontSize.button,
    fontWeight: 700,
    textAlign: 'center',
  },
});
