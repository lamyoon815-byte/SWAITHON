import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';

type Props = {
  label: string;
  value: SharedValue<number>;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  palette: Palette;
};

/** Writes straight into a shared value, so the Skia canvas updates without a React re-render. */
export function LabeledSlider({ label, value, min, max, step, format, palette }: Props) {
  const [display, setDisplay] = useState(value.get());
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: palette.text }]}>
        {label}: {format(display)}
      </Text>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={display}
        onValueChange={(v) => {
          value.set(v);
          setDisplay(v);
        }}
        minimumTrackTintColor={palette.accent}
        maximumTrackTintColor={palette.border}
        thumbTintColor={palette.accent}
        accessibilityLabel={label}
        accessibilityValue={{ text: format(display) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: FontSize.label,
    fontWeight: 700,
  },
  slider: {
    height: MinTouchTarget,
  },
});
