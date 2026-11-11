import { StyleSheet, View } from 'react-native';
import { useState } from 'react';
import { Text } from '@/components/common/text';
import { FontSize, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';

/** 24dp 손잡이의 실제 이동 구간에 맞춘 공통 회색 눈금과 양끝 값. */
export function SliderScale({ min, max, palette, neutralPosition }: { min: string; max: string; palette: Palette; neutralPosition?: number }) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.scale}>
    <View style={styles.ticks}>{(neutralPosition === undefined ? [0, 1, 2, 3, 4, 5] : [0, 5]).map((step) => <View key={step} style={[styles.tick, { backgroundColor: palette.outline }]} />)}</View>
    {neutralPosition !== undefined && <View style={[styles.neutralTick, { left: `${neutralPosition * 100}%`, backgroundColor: palette.outline }]} />}
    <View style={styles.endpoints}>
      <Text style={[styles.label, styles.labelSpacer]}>{max}</Text>
      <ScaleLabel value={min} position={0} palette={palette} />
      <ScaleLabel value={max} position={1} palette={palette} />
      {neutralPosition !== undefined && <ScaleLabel value="0" position={neutralPosition} palette={palette} />}
    </View>
  </View>;
}

/** 숫자의 실제 너비가 달라도 중심을 해당 눈금 위치에 맞춘다. */
function ScaleLabel({ value, position, palette }: { value: string; position: number; palette: Palette }) {
  const [width, setWidth] = useState(0);
  return <Text onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    style={[styles.label, styles.centeredLabel, { left: `${position * 100}%`, marginLeft: -width / 2, color: palette.textSecondary }]}>{value}</Text>;
}
const styles = StyleSheet.create({
  scale: { marginHorizontal: 12, marginTop: -Spacing.two },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', height: 8 },
  tick: { width: 2, height: 8 },
  neutralTick: { position: 'absolute', top: 0, width: 2, height: 8, marginLeft: -1 },
  endpoints: { position: 'relative', marginHorizontal: 1 },
  label: { fontSize: FontSize.label, fontVariant: ['tabular-nums'] },
  labelSpacer: { opacity: 0 },
  centeredLabel: { position: 'absolute', top: 0, textAlign: 'center' },
});
