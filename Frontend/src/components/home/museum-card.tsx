import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';

import { ButtonRadius, FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import type { Museum } from '@/types/museum';

type Props = {
  museum: Museum | undefined;
  palette: Palette;
  onChange: () => void;
};

/**
 * 홈 맨 위 "현재 미술관" 카드. 고른 미술관이 있으면 강조색 카드에 "변경" 버튼,
 * 없으면 카드 전체가 "미술관을 선택해 주세요 · 선택하기" 버튼이 된다.
 */
export function MuseumCard({ museum, palette, onChange }: Props) {
  if (museum) {
    return (
      <View style={[styles.card, { backgroundColor: palette.highlight }]}>
        <View style={styles.texts}>
          <Text style={[styles.caption, { color: palette.highlightText }]}>현재 미술관</Text>
          <Text style={[styles.name, { color: palette.highlightText }]}>{museum.name}</Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`현재 미술관 ${museum.name}, 변경`}
          onPress={onChange}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: palette.highlightText, opacity: pressed ? 0.8 : 1 },
          ]}>
          <Text style={[styles.pillText, { color: palette.highlight }]}>변경</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="현재 미술관 없음, 미술관 선택하기"
      onPress={onChange}
      style={({ pressed }) => [
        styles.card,
        styles.empty,
        { backgroundColor: palette.surface, borderColor: palette.accent, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={styles.texts}>
        <Text style={[styles.caption, { color: palette.textSecondary }]}>현재 미술관</Text>
        <Text style={[styles.name, { color: palette.text }]}>미술관을 선택해 주세요</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: palette.accent }]}>
        <Text style={[styles.pillText, { color: palette.accentText }]}>선택하기</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: 18,
    paddingLeft: 20,
    paddingRight: Spacing.three,
    borderRadius: 24,
  },
  empty: {
    borderWidth: 2,
  },
  texts: {
    flex: 1,
    gap: Spacing.one,
  },
  caption: {
    fontSize: 16,
    fontWeight: 700,
  },
  name: {
    fontSize: FontSize.body,
    fontWeight: 800,
    lineHeight: 26,
  },
  // Its own tap target ("변경"), so it gets the full 56 minimum.
  pill: {
    minHeight: MinTouchTarget,
    minWidth: MinTouchTarget,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 17,
    fontWeight: 800,
  },
});
