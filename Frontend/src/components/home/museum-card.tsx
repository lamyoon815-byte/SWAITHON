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
 * 홈 맨 위 "현재 미술관" 카드. 변경·선택하기 모양을 유지하며 카드 전체가 선택 화면을 연다.
 */
export function MuseumCard({ museum, palette, onChange }: Props) {
  if (museum) {
    return (
      <PressableScale accessibilityRole="button" accessibilityLabel={`현재 미술관 ${museum.name}, 변경`} accessibilityHint="미술관 선택 화면을 열어요" onPress={onChange}
        style={({ pressed }) => [styles.card, { backgroundColor: palette.highlight, opacity: pressed ? 0.8 : 1 }]}>
        <View style={styles.texts}>
          <Text style={[styles.caption, { color: palette.highlightText }]}>현재 미술관</Text>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.name, { color: palette.highlightText }]}>{museum.name}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: palette.highlightText }]}>
          <Text style={[styles.pillText, { color: palette.highlight }]}>변경</Text>
        </View>
      </PressableScale>
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
        <Text lineBreakStrategyIOS="hangul-word" style={[styles.name, { color: palette.text }]}>미술관을 선택해 주세요</Text>
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
    fontSize: FontSize.label,
    fontWeight: 700,
  },
  // 홈에서 가장 먼저 읽히는 정보라 제목급(26)으로. 긴 이름은 두 줄로 넘어간다.
  name: {
    fontSize: FontSize.heading,
    fontWeight: 800,
    lineHeight: 34,
  },
  // 카드 안의 변경·선택하기 표시. 이 부분을 눌러도 카드와 같은 동작을 한다.
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
    fontSize: FontSize.label,
    fontWeight: 800,
  },
});
