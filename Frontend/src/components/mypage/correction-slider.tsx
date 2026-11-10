import Slider, { type SliderRef } from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { correctionDisplayValue, formatCorrection, type CorrectionField } from '@/lib/profile-format';
import { correctionDetent } from '@/lib/correction-detent';

const THUMB_SIZE = 24;

export const CORRECTION_CONTROLS = [
  { field: 'contrast', label: '대비', min: 0.5, max: 2, step: 0.05 },
  { field: 'brightness', label: '밝기', min: -1, max: 1, step: 0.05 },
  { field: 'sharpen', label: '선명도', min: 0, max: 2, step: 0.05 },
] as const;

type Props = {
  control: (typeof CORRECTION_CONTROLS)[number];
  value: number;
  disabled: boolean;
  palette: Palette;
  onChange: (field: CorrectionField, value: number) => void;
};

export function CorrectionSlider({ control: c, value, disabled, palette, onChange }: Props) {
  const slider = useRef<SliderRef & { setNativeProps?: (props: { value: number }) => void }>(null);
  const [sliderVersion, setSliderVersion] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const neutral = c.field === 'contrast' ? 1 : 0;
  const hasDetent = c.field !== 'sharpen';
  const detent = useRef({ raw: value, latched: value === neutral });
  const zeroPosition = THUMB_SIZE / 2 + Math.max(0, trackWidth - THUMB_SIZE) * ((neutral - c.min) / (c.max - c.min));
  const feedback = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  };
  const set = (next: number) => onChange(c.field, Math.round(Math.max(c.min, Math.min(c.max, next)) * 100) / 100);
  const drag = (raw: number) => {
    if (!hasDetent) { set(raw); return; }
    const next = correctionDetent(raw, detent.current.raw, detent.current.latched, neutral, c.step);
    detent.current = { raw, latched: next.latched };
    if (next.entered) feedback();
    // value는 write-only이므로 같은 0이 이어져도 네이티브 손잡이를 직접 고정한다.
    if (next.latched && raw !== neutral) {
      if (Platform.OS === 'web') slider.current?.updateValue(neutral);
      else slider.current?.setNativeProps?.({ value: neutral });
    }
    set(next.value);
  };
  const step = (direction: -1 | 1) => {
    const next = Math.round((value + direction * c.step) * 100) / 100;
    if (hasDetent && next === neutral && value !== neutral) feedback();
    set(next);
  };
  return (
    <View style={[styles.control, disabled && styles.disabled]}>
      <View style={styles.heading}>
        <Text style={[styles.label, { color: palette.text }]}>{c.label}</Text>
        <Text style={[styles.label, styles.value, { color: palette.text }]}>{c.field === 'sharpen' ? correctionDisplayValue(c.field, value) : formatCorrection(c.field, value)}</Text>
      </View>
      <View style={styles.row}>
        <StepButton kind="minus" label={`${c.label} 줄이기`} disabled={disabled || value <= c.min} palette={palette} onPress={() => step(-1)} />
        <View style={styles.trackArea} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
          <Slider
          key={sliderVersion}
          ref={slider}
          style={styles.slider}
          minimumValue={c.min}
          maximumValue={c.max}
          step={c.step}
          value={value}
          disabled={disabled}
          onSlidingStart={(raw) => { detent.current = { raw, latched: Math.abs(raw - neutral) < 1e-8 }; }}
          onValueChange={drag}
          onSlidingComplete={(raw) => {
            drag(raw);
            // 네이티브 슬라이더는 드래그 중 value 갱신을 미룰 수 있어 놓을 때도 위치를 확정한다.
            if (hasDetent && detent.current.latched) setSliderVersion((version) => version + 1);
          }}
          minimumTrackTintColor={palette.highlight}
          maximumTrackTintColor={palette.outline}
          thumbTintColor={palette.highlight}
          thumbSize={THUMB_SIZE}
          accessibilityLabel={c.label}
          accessibilityState={{ disabled }}
          accessibilityValue={{ min: correctionDisplayValue(c.field, c.min), max: correctionDisplayValue(c.field, c.max), now: correctionDisplayValue(c.field, value), text: formatCorrection(c.field, value) }}
          />
          {hasDetent && <View pointerEvents="none" style={[styles.zeroTick, { left: zeroPosition, backgroundColor: palette.outline }]} />}
          <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.scale, { marginHorizontal: THUMB_SIZE / 2 }]}>
            {hasDetent ? (
              <Text style={[styles.scaleText, styles.zeroLabel, { left: zeroPosition - THUMB_SIZE / 2, color: palette.textSecondary }]}>0</Text>
            ) : (
              <>
                <Text style={[styles.scaleText, { color: palette.textSecondary }]}>0</Text>
                <Text style={[styles.scaleText, { color: palette.textSecondary }]}>200</Text>
              </>
            )}
          </View>
        </View>
        <StepButton kind="plus" label={`${c.label} 높이기`} disabled={disabled || value >= c.max} palette={palette} onPress={() => step(1)} />
      </View>
    </View>
  );
}

function StepButton({ kind, label, disabled, palette, onPress }: {
  kind: 'minus' | 'plus'; label: string; disabled: boolean; palette: Palette; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.step, { borderColor: palette.border, backgroundColor: pressed ? palette.highlight : palette.fill, opacity: disabled ? 0.4 : 1 }]}>
      {({ pressed }) => <SymbolView name={kind === 'plus' ? { ios: 'plus', android: 'add', web: 'add' } : { ios: 'minus', android: 'remove', web: 'remove' }} size={22} weight="semibold" tintColor={pressed ? palette.highlightText : palette.text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { paddingTop: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.three },
  disabled: { opacity: 0.4 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  label: { fontSize: FontSize.body, fontWeight: 700 },
  value: { fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  trackArea: { flex: 1 },
  slider: { width: '100%', height: MinTouchTarget },
  zeroTick: { position: 'absolute', top: MinTouchTarget / 2 + 4, width: 2, height: 10, marginLeft: -1 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative', minHeight: 24 },
  scaleText: { fontSize: FontSize.label, fontVariant: ['tabular-nums'], transform: [{ translateY: -Spacing.one }] },
  zeroLabel: { position: 'absolute', width: 40, marginLeft: -20, textAlign: 'center' },
  step: { width: MinTouchTarget, height: MinTouchTarget, borderRadius: MinTouchTarget / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
