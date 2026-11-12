import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
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
  /** 글자 앞 장식 아이콘. 버튼 글자색을 받아 그린다(색으로 구분하지 않도록 같은 색). 스크린리더는 읽지 않는다 */
  icon?: (color: string) => ReactNode;
  /** 여러 버튼의 아이콘을 세로로 맞출 때: 이 글자(가장 긴 글자) 너비만큼 글자 칸을 잡고 왼쪽 정렬한다 */
  alignLabelTo?: string;
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
  icon,
  alignLabelTo,
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
      {!radio && icon && <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.icon}>{icon(color)}</View>}
      {alignLabelTo ? (
        <View>
          <Text accessible={false} importantForAccessibility="no" style={[styles.label, styles.sizer]}>{alignLabelTo}</Text>
          <Text style={[styles.label, styles.aligned, { color }]}>{label}</Text>
        </View>
      ) : (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
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
  icon: { marginRight: 8 },
  sizer: { opacity: 0 },
  aligned: { position: 'absolute', left: 0, top: 0, textAlign: 'left' },
  label: {
    flexShrink: 1,
    fontSize: FontSize.button,
    fontWeight: 700,
    textAlign: 'center',
  },
});
