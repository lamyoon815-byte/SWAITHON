// 크게 넘겨보기 (디자인 "저시력 미술관 앱" 작품 선택 시안2). 홈의 "크게 넘겨보기 ›"에서 들어온다
/**
 * 현재 미술관의 작품을 한 점씩 크게 넘겨 본다. 좌우로 밀거나 ‹ › 버튼으로 넘긴다.
 * 가운데 카드는 크고 테두리가 있고, 양옆 카드는 작고 흐리다 (색만이 아니라 크기로도 구분).
 * 가운데 카드나 "작품 보기"를 누르면 작품 상세로, 옆 카드를 누르면 그 카드로 넘어간다.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Artwork } from '@/types/artwork';

const CARD_GAP = 14;
const SIDE_SCALE = 0.88;

/** 넘겨보기 카드 밑에 두 줄로 보여 줄 소개. 검수된 해설이 없으면 안내 문구. */
function summary(artwork: Artwork) {
  return artwork.description?.facts[0] ?? artwork.background ?? '아직 해설이 준비되지 않았어요';
}

export default function BrowseScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const { settings } = useSettings();
  const museumId = settings.recent_museum_id;
  const { data: museums } = useResource('museums', getMuseums);
  const { data: artworks } = useResource(museumId, () => getMuseumArtworks(museumId!));
  const listRef = useRef<FlatList<Artwork>>(null);
  const [index, setIndex] = useState(0);

  const museum = museums?.find((m) => m.id === museumId);
  const works = artworks ?? [];
  const current = works[Math.min(index, works.length - 1)];
  const cardWidth = Math.min(260, width - 120);
  const cardHeight = Math.round(cardWidth * 1.23);
  const interval = cardWidth + CARD_GAP;
  const sidePadding = (width - cardWidth) / 2;
  // Mustard text is too faint on the light background, so light mode uses the body text color.
  const metaColor = scheme === 'dark' ? palette.highlight : palette.text;

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(works.length - 1, i));
    if (next === index) return;
    setIndex(next);
    listRef.current?.scrollToOffset({
      offset: next * interval,
      animated: true,
    });
    AccessibilityInfo.announceForAccessibility(`${next + 1}번째 작품, ${works[next].title}`);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / interval);
    const next = Math.max(0, Math.min(works.length - 1, i));
    if (next !== index) {
      setIndex(next);
      AccessibilityInfo.announceForAccessibility(`${next + 1}번째 작품, ${works[next].title}`);
    }
  };

  const openArtwork = (artwork: Artwork) =>
    router.push({ pathname: '/artwork/[id]', params: { id: artwork.id } });

  const atFirst = index <= 0;
  const atLast = index >= works.length - 1;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <BackButton label="작품 목록으로" palette={palette} />
        <View style={styles.headerCenter}>
          {!!museum && (
            <Text numberOfLines={1} style={[styles.headerMuseum, { color: metaColor }]}>
              {museum.name}
            </Text>
          )}
          <Text accessibilityRole="header" style={[styles.headerTitle, { color: palette.text }]}>
            작품 선택
          </Text>
        </View>
        <Text
          accessibilityLabel={works.length ? `${works.length}점 중 ${index + 1}번째` : undefined}
          style={[styles.position, { color: palette.textSecondary }]}>
          {works.length ? `${index + 1} / ${works.length}` : ''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        {artworks && works.length === 0 ? (
          <Text style={[styles.empty, { color: palette.textSecondary }]}>
            이 미술관에는 아직 작품이 없어요
          </Text>
        ) : (
          <FlatList
            ref={listRef}
            horizontal
            data={works}
            keyExtractor={(a) => a.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={interval}
            decelerationRate="fast"
            onMomentumScrollEnd={onScrollEnd}
            contentContainerStyle={{
              paddingHorizontal: sidePadding,
              gap: CARD_GAP,
            }}
            style={{ height: cardHeight + 24, marginTop: Spacing.three }}
            renderItem={({ item, index: i }) => (
              <Card
                artwork={item}
                current={i === index}
                width={cardWidth}
                height={cardHeight}
                palette={palette}
                onPress={() => (i === index ? openArtwork(item) : goTo(i))}
              />
            )}
          />
        )}

        {current && (
          <View style={styles.info}>
            <Text style={[styles.title, { color: palette.text }]}>{current.title}</Text>
            <Text style={[styles.artist, { color: palette.textSecondary }]}>
              {[current.artist, current.year].filter(Boolean).join(' · ')}
            </Text>
            <Text numberOfLines={2} style={[styles.summary, { color: palette.textSecondary }]}>
              {summary(current)}
            </Text>
          </View>
        )}

        {current && (
          <View style={styles.controls}>
            <RoundButton
              direction="prev"
              a11yLabel={atFirst ? '이전 작품, 첫 작품이에요' : '이전 작품'}
              disabled={atFirst}
              palette={palette}
              onPress={() => goTo(index - 1)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${current.title} 작품 보기`}
              onPress={() => openArtwork(current)}
              style={({ pressed }) => [
                styles.open,
                { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.openText, { color: palette.accentText }]}>작품 보기</Text>
            </Pressable>
            <RoundButton
              direction="next"
              a11yLabel={atLast ? '다음 작품, 마지막 작품이에요' : '다음 작품'}
              disabled={atLast}
              palette={palette}
              onPress={() => goTo(index + 1)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type CardProps = {
  artwork: Artwork;
  current: boolean;
  width: number;
  height: number;
  palette: Palette;
  onPress: () => void;
};

function Card({ artwork, current, width, height, palette, onPress }: CardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artwork.number}번, ${artwork.title}, ${artwork.artist}`}
      accessibilityHint={current ? '작품 상세로 이동해요' : '이 작품으로 넘겨요'}
      onPress={onPress}
      style={[
        styles.card,
        {
          width,
          height,
          backgroundColor: palette.fill,
          borderColor: current ? palette.highlight : 'transparent',
          opacity: current ? 1 : 0.45,
          transform: [{ scale: current ? 1 : SIDE_SCALE }],
        },
      ]}>
      {artwork.image_url ? (
        <Image
          source={{ uri: artwork.image_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={styles.cardEmpty}>
          <Text style={[styles.cardEmptyText, { color: palette.textSecondary }]}>
            작품 이미지 준비 중
          </Text>
        </View>
      )}
      {!!artwork.number && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>No. {artwork.number}</Text>
        </View>
      )}
    </Pressable>
  );
}

type RoundButtonProps = {
  direction: 'prev' | 'next';
  a11yLabel: string;
  disabled: boolean;
  palette: Palette;
  onPress: () => void;
};

function RoundButton({ direction, a11yLabel, disabled, palette, onPress }: RoundButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          backgroundColor: palette.fill,
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}>
      <SymbolView
        name={
          direction === 'prev'
            ? { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }
            : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
        }
        size={24}
        weight="bold"
        tintColor={palette.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerMuseum: {
    fontSize: 16,
    fontWeight: 700,
  },
  headerTitle: {
    fontSize: FontSize.body,
    fontWeight: 800,
  },
  position: {
    minWidth: MinTouchTarget,
    fontSize: 16,
    fontWeight: 700,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  card: {
    borderRadius: 28,
    borderWidth: 3,
    overflow: 'hidden',
    alignSelf: 'center',
    justifyContent: 'flex-end',
  },
  cardEmpty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmptyText: {
    fontSize: 16,
    fontWeight: 600,
  },
  // Fixed dark scrim: the badge sits on the artwork image, not on the app background.
  badge: {
    alignSelf: 'flex-start',
    margin: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 800,
  },
  info: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 35,
    textAlign: 'center',
  },
  artist: {
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
  summary: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: 500,
    lineHeight: 27,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
  },
  round: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A minimum, not a fixed height: the label grows with the system text size.
  open: {
    flex: 1,
    maxWidth: 220,
    minHeight: MinTouchTarget,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  empty: {
    padding: Spacing.four,
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
});
