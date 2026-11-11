// 크게 넘겨보기 (디자인 "저시력 미술관 앱" 작품 선택 시안2). 홈의 "크게 넘겨보기 ›"에서 들어온다
/**
 * 현재 미술관의 작품을 한 점씩 크게 넘겨 본다. 좌우로 밀거나 카드 양옆 ‹ › 버튼으로 넘긴다.
 * 가운데 카드는 크고 테두리가 있고, 양옆 카드는 작고 흐리다 (색만이 아니라 크기로도 구분).
 * 크기·흐림은 밀어 넘기는 만큼 따라 바뀌고(토스처럼 슉슉), 제목·소개는 바뀔 때 살짝 떠오른다.
 * "동작 줄이기"가 켜져 있으면 버튼으로 넘길 때 미끄러지지 않고 바로 바뀐다.
 * ‹ ›는 카드 줄 양옆에, "작품 보기"는 그 아래 따로 한 줄로 둬서 넘기기와 열기를 헷갈리지 않게 한다.
 * 가운데 카드나 "작품 보기"를 누르면 작품 상세로, 옆 카드를 누르면 그 카드로 넘어간다.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, type FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text } from '@/components/common/text';
import Animated, {
  Extrapolation,
  FadeInDown,
  ReduceMotion,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { PressableScale } from '@/components/common/pressable-scale';
import {
  ButtonHeight,
  ButtonRadius,
  FontSize,
  MinTouchTarget,
  getPalette,
  type Palette,
} from '@/constants/a11y';
import { ScreenPadding, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Artwork } from '@/types/artwork';

const CARD_GAP = 14;
const SIDE_SCALE = 0.88;
const SIDE_OPACITY = 0.45;

/** 넘겨보기 카드 밑에 두 줄로 보여 줄 소개. 없으면 아무것도 보이지 않는다(작품에 들어가면 AI 해설이 나온다). */
function summary(artwork: Artwork) {
  // background of overseas works is the museum's English text (only a source for the AI script): show it only in Korean.
  const background = artwork.background && /[가-힣]/.test(artwork.background) ? artwork.background : null;
  return artwork.description?.facts[0] ?? background;
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
  const reduceMotion = useReducedMotion();
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.set(e.contentOffset.x);
  });

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
      animated: !reduceMotion,
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
          <View style={styles.stage}>
            <Animated.FlatList
              ref={listRef}
              horizontal
              data={works}
              keyExtractor={(a) => a.id}
              showsHorizontalScrollIndicator={false}
              snapToInterval={interval}
              decelerationRate="fast"
              onScroll={onScroll}
              scrollEventThrottle={16}
              onMomentumScrollEnd={onScrollEnd}
              contentContainerStyle={{
                paddingHorizontal: sidePadding,
                gap: CARD_GAP,
              }}
              style={{ height: cardHeight + 24 }}
              renderItem={({ item, index: i }) => (
                <Card
                  artwork={item}
                  index={i}
                  current={i === index}
                  scrollX={scrollX}
                  interval={interval}
                  width={cardWidth}
                  height={cardHeight}
                  palette={palette}
                  onPress={() => (i === index ? openArtwork(item) : goTo(i))}
                />
              )}
            />
            {/* ‹ › on the card row itself, over the dimmed side cards. */}
            {!!current && (
              <View pointerEvents="box-none" style={styles.arrows}>
                <RoundButton
                  direction="prev"
                  a11yLabel={atFirst ? '이전 작품, 첫 작품이에요' : '이전 작품'}
                  disabled={atFirst}
                  palette={palette}
                  onPress={() => goTo(index - 1)}
                />
                <RoundButton
                  direction="next"
                  a11yLabel={atLast ? '다음 작품, 마지막 작품이에요' : '다음 작품'}
                  disabled={atLast}
                  palette={palette}
                  onPress={() => goTo(index + 1)}
                />
              </View>
            )}
          </View>
        )}

        {current && (
          <Animated.View
            key={current.id}
            entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
            style={styles.info}>
            <Text style={[styles.title, { color: palette.text }]}>{current.title}</Text>
            <Text style={[styles.artist, { color: palette.textSecondary }]}>
              {[current.artist, current.year].filter(Boolean).join(' · ')}
            </Text>
            {!!summary(current) && (
              <Text numberOfLines={2} style={[styles.summary, { color: palette.textSecondary }]}>
                {summary(current)}
              </Text>
            )}
          </Animated.View>
        )}

        {current && (
          <View style={styles.controls}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${current.title} 작품 보기`}
              onPress={() => openArtwork(current)}
              style={({ pressed }) => [
                styles.open,
                { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.openText, { color: palette.accentText }]}>작품 보기</Text>
            </PressableScale>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type CardProps = {
  artwork: Artwork;
  index: number;
  current: boolean;
  scrollX: SharedValue<number>;
  interval: number;
  width: number;
  height: number;
  palette: Palette;
  onPress: () => void;
};

function Card({
  artwork,
  index,
  current,
  scrollX,
  interval,
  width,
  height,
  palette,
  onPress,
}: CardProps) {
  // 그림의 원래 비율. 받기 전에는 틀(width × height) 전체를 쓴다.
  const [ratio, setRatio] = useState<number | null>(null);
  const slotRatio = width / height;
  // 그림이 잘리지 않게 틀 안에 비율대로 맞춘 테두리 상자 크기.
  const frame = ratio === null ? { width, height }
    : ratio > slotRatio ? { width, height: Math.round(width / ratio) }
      : { width: Math.round(height * ratio), height };

  // 0 when this card is centered, 1 when it is one card away. Follows the finger while swiping.
  const motion = useAnimatedStyle(() => {
    const away = Math.abs(scrollX.get() / interval - index);
    return {
      opacity: interpolate(away, [0, 1], [1, SIDE_OPACITY], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(away, [0, 1], [1, SIDE_SCALE], Extrapolation.CLAMP) }],
    };
  });

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${artwork.number}번, ${artwork.title}, ${artwork.artist}`}
      accessibilityHint={current ? '작품 상세로 이동해요' : '이 작품으로 넘겨요'}
      onPress={onPress}
      style={[styles.slot, { width, height }, motion]}>
      {/* 테두리 상자는 그림 비율에 맞춰 줄어든다(가로로 긴 작품도 잘리지 않음). 넘기기 간격은 바깥 틀이 지킨다. */}
      <View style={[styles.card, frame, { backgroundColor: palette.fill, borderColor: current ? palette.highlight : 'transparent' }]}>
      {artwork.image_url ? (
        <Image
          source={{ uri: artwork.image_url }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={150}
          onLoad={(event) => {
            const { width: w, height: h } = event.source;
            if (w > 0 && h > 0) setRatio(w / h);
          }}
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
      </View>
    </AnimatedPressable>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type RoundButtonProps = {
  direction: 'prev' | 'next';
  a11yLabel: string;
  disabled: boolean;
  palette: Palette;
  onPress: () => void;
};

function RoundButton({ direction, a11yLabel, disabled, palette, onPress }: RoundButtonProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          backgroundColor: palette.surface,
          borderColor: palette.outline,
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
    </PressableScale>
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
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerMuseum: {
    fontSize: 24,
    fontWeight: 800,
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
  slot: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 24,
    borderWidth: 3,
    overflow: 'hidden',
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
  stage: {
    marginTop: Spacing.three,
    justifyContent: 'center',
  },
  // Left and right of the card row, vertically centered on the cards.
  arrows: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  controls: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.four,
  },
  // Sits on top of artwork images, so it gets its own surface, outline and shadow.
  round: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Shadow.floating,
  },
  // A minimum, not a fixed height: the label grows with the system text size.
  open: {
    minHeight: ButtonHeight,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    borderRadius: ButtonRadius,
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
