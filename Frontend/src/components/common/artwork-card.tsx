import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';

import { FontSize, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import type { Artwork } from '@/types/artwork';

type Props = {
  artwork: Artwork;
  palette: Palette;
  onPress: () => void;
};

/**
 * 작품 한 줄: 미리보기 이미지 · 제목 · 작가와 연도. 줄 전체가 하나의 버튼이다 (1, 4-1, 7).
 * 강조색은 현재 미술관과 선택된 탭에만 쓰고, 여기서는 "›" 아이콘으로 누를 수 있음만 알린다.
 */
export function ArtworkCard({ artwork, palette, onPress }: Props) {
  const byline = [artwork.artist, artwork.year].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artwork.number}번, ${artwork.title}, ${byline}`}
      accessibilityHint="작품 감상 화면으로 이동해요"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.fill }]}>
      <View style={[styles.thumb, { backgroundColor: palette.fill }]}>
        {artwork.image_url ? (
          <Image source={{ uri: artwork.image_url }} style={StyleSheet.absoluteFill} contentFit="cover"
            transition={150} cachePolicy="memory-disk" recyclingKey={artwork.id} />
        ) : (
          <Text style={[styles.thumbText, { color: palette.text }]}>{artwork.number}</Text>
        )}
      </View>
      <View style={styles.body}>
        {/* Long titles stop at two lines so one row never fills the screen; the full title is in the label. */}
        <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>{artwork.title}</Text>
        <Text numberOfLines={1} style={[styles.byline, { color: palette.textSecondary }]}>{byline}</Text>
      </View>
      {/* An icon, not a "›" glyph: glyphs change shape with the font and grow with system text size. */}
      <View style={styles.chevron}>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={22}
          weight="bold"
          tintColor={palette.textSecondary}
        />
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
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  body: {
    flex: 1,
    minWidth: 0,
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
  chevron: {
    paddingHorizontal: Spacing.two,
  },
});
