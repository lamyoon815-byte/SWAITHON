/**
 * 보정 강도 (와이어프레임 2). 0%면 원본, 100%면 내 시각 프로필 그대로.
 * 끌기 어려운 사람을 위해 슬라이더 양옆에 −/+ 버튼(10%씩)을 둔다.
 * "원본 보기" 중에는 강도가 화면에 드러나지 않으니 흐리게 하고 누를 수 없게 한다 (자리는 그대로).
 */

import Slider from '@react-native-community/slider';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';

const STEP = 0.1;

type Props = {
  /** 0~1 */
  value: number;
  disabled: boolean;
  palette: Palette;
  onChange: (value: number) => void;
};

function percent(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function StrengthControl({ value, disabled, palette, onChange }: Props) {
  const set = (v: number) => onChange(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.outline },
        disabled && styles.disabled,
      ]}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: palette.text }]}>보정 강도</Text>
        <Text style={[styles.value, { color: palette.text }]}>{percent(value)}</Text>
      </View>
      {disabled && (
        <Text style={[styles.note, { color: palette.textSecondary }]}>
          보정본을 고르면 바꿀 수 있어요
        </Text>
      )}
      <View style={styles.row}>
        <StepButton
          kind="minus"
          label="보정 약하게"
          disabled={disabled || value <= 0}
          palette={palette}
          onPress={() => set(value - STEP)}
        />
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={value}
          disabled={disabled}
          onValueChange={set}
          minimumTrackTintColor={palette.highlight}
          maximumTrackTintColor={palette.outline}
          thumbTintColor={palette.highlight}
          accessibilityLabel="보정 강도"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(value * 100),
            text: percent(value),
          }}
        />
        <StepButton
          kind="plus"
          label="보정 강하게"
          disabled={disabled || value >= 1}
          palette={palette}
          onPress={() => set(value + STEP)}
        />
      </View>
      <View style={styles.ends}>
        <Text style={[styles.end, { color: palette.textSecondary }]}>원본에 가깝게</Text>
        <Text style={[styles.end, { color: palette.textSecondary }]}>내 보정 그대로</Text>
      </View>
    </View>
  );
}

type StepProps = {
  kind: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  palette: Palette;
  onPress: () => void;
};

function StepButton({ kind, label, disabled, palette, onPress }: StepProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        {
          backgroundColor: pressed ? palette.highlight : palette.fill,
          opacity: disabled ? 0.35 : 1,
        },
      ]}>
      {({ pressed }) => (
        <SymbolView
          name={
            kind === 'minus'
              ? { ios: 'minus', android: 'remove', web: 'remove' }
              : { ios: 'plus', android: 'add', web: 'add' }
          }
          size={22}
          weight="semibold"
          tintColor={pressed ? palette.highlightText : palette.text}
        />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1.5,
    borderRadius: 24,
  },
  disabled: {
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  value: {
    fontSize: FontSize.label,
    fontWeight: 800,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: 16,
    fontWeight: 600,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  slider: {
    flex: 1,
    height: MinTouchTarget,
  },
  step: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: MinTouchTarget + Spacing.two,
  },
  end: {
    fontSize: 15,
    fontWeight: 600,
  },
});
