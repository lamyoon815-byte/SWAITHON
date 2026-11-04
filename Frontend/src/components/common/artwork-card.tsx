import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Colors, Spacing } from '@/constants/theme';
import type { Artwork } from '@/types/artwork';

type Props = {
  artwork: Artwork;
  palette: Palette;
  scheme: 'light' | 'dark';
  onPress: () => void;
};

/** 작품 한 줄: 번호 · 제목 · 작가와 연도 · "보기". 줄 전체가 하나의 버튼이다 (1, 4-1, 7). */
export function ArtworkCard({ artwork, palette, scheme, onPress }: Props) {
  const byline = [artwork.artist, artwork.year].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artwork.number}번, ${artwork.title}, ${byline}`}
      accessibilityHint="작품 감상 화면으로 이동해요"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: Colors[scheme].backgroundSelected }]}>
      <View style={[styles.number, { backgroundColor: Colors[scheme].backgroundSelected }]}>
        <Text style={[styles.numberText, { color: palette.text }]}>{artwork.number}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text }]}>{artwork.title}</Text>
        <Text style={[styles.byline, { color: palette.textSecondary }]}>{byline}</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: palette.accent }]}>
        <Text style={[styles.pillText, { color: palette.accentText }]}>보기</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 80,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: 20,
  },
  number: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: FontSize.label,
    fontWeight: 700,
    lineHeight: 24,
  },
  byline: {
    fontSize: 16,
    fontWeight: 500,
  },
  pill: {
    height: 44,
    minWidth: MinTouchTarget,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 16,
    fontWeight: 800,
  },
});
