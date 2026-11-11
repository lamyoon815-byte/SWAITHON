import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Text } from '@/components/common/text';
import { CorrectionStepButton } from '@/components/mypage/correction-slider';
import { SliderScale } from '@/components/mypage/slider-scale';
import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';

type Props = { label: string; value: number; disabled: boolean; palette: Palette; onChange: (value: number) => void; onCommit?: () => void };

/** 0~5 정수 단계를 사용하여 20% 간격의 이미지와 값을 일치시킨다. */
export function CalibrationSlider({ label, value, disabled, palette, onChange, onCommit }: Props) {
  const index = Math.round(value * 5);
  const lastIndex = useRef(index);
  const change = (raw: number) => {
    if (disabled) return;
    const next = Math.max(0, Math.min(5, Math.round(raw)));
    if (next !== lastIndex.current && Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    lastIndex.current = next;
    onChange(next / 5);
  };
  return <View style={[styles.control, disabled && styles.disabled]}>
    <View style={styles.heading}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.label, { color: palette.text }]}>{index * 20}%</Text>
    </View>
    <View style={styles.row}>
      <CorrectionStepButton kind="minus" label={`${label} 20% 줄이기`} palette={palette} disabled={disabled || index === 0} onPress={() => { change(index - 1); onCommit?.(); }} />
      <View style={styles.track}>
        <Slider style={styles.slider} value={index} minimumValue={0} maximumValue={5} step={1} disabled={disabled}
          onSlidingStart={() => { lastIndex.current = index; }} onValueChange={change} onSlidingComplete={(raw) => { change(raw); onCommit?.(); }}
          minimumTrackTintColor={palette.highlight} maximumTrackTintColor={palette.outline} thumbTintColor={palette.highlight} thumbSize={24}
          accessibilityLabel={label} accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: 100, now: index * 20, text: `${index * 20}%` }} />
        <SliderScale min="0" max="100%" palette={palette} />
      </View>
      <CorrectionStepButton kind="plus" label={`${label} 20% 높이기`} palette={palette} disabled={disabled || index === 5} onPress={() => { change(index + 1); onCommit?.(); }} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  control: { paddingTop: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.three },
  disabled: { opacity: 0.4 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.two },
  label: { fontSize: FontSize.body, fontWeight: 700, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  track: { flex: 1 },
  slider: { width: '100%', height: MinTouchTarget },
});
