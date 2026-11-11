import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { FontSize, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';

/** 24dp 손잡이의 실제 이동 구간에 맞춘 공통 회색 눈금과 양끝 값. */
export function SliderScale({ min, max, palette, neutralPosition }: { min: string; max: string; palette: Palette; neutralPosition?: number }) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.scale}>
    <View style={styles.ticks}>{[0, 1, 2, 3, 4, 5].map((step) => <View key={step} style={[styles.tick, { backgroundColor: palette.outline }]} />)}</View>
    {neutralPosition !== undefined && <View style={[styles.neutralTick, { left: `${neutralPosition * 100}%`, backgroundColor: palette.outline }]} />}
    <View style={styles.endpoints}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{min}</Text>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{max}</Text>
    </View>
    {neutralPosition !== undefined && <Text style={[styles.label, styles.neutralLabel, { left: `${neutralPosition * 100}%`, color: palette.textSecondary }]}>0</Text>}
  </View>;
}
const styles = StyleSheet.create({
  scale: { marginHorizontal: 12, marginTop: -Spacing.two },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', height: 8 },
  tick: { width: 2, height: 8 },
  neutralTick: { position: 'absolute', top: 0, width: 2, height: 8, marginLeft: -1 },
  endpoints: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  label: { fontSize: FontSize.label, fontVariant: ['tabular-nums'] },
  neutralLabel: { position: 'absolute', top: 8, width: 40, marginLeft: -20, textAlign: 'center' },
});
