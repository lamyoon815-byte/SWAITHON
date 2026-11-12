// 와이어프레임 1 홈 (작품 선택). 번호 입력(1-1)은 검색 화면(`/search`)으로 옮겼다
/**
 * 현재 미술관 카드 → 길고 둥근 검색창(네이버처럼. 누르면 검색 화면) → 그 아래 반반 두 칸
 * (카메라로 찾기 · 음성으로 찾기)
 * → 작품 목록 카드(토스처럼 카드로 묶음, 테두리는 배경과 3:1 이상).
 * 목록은 불러오는 중 · 오류 · 빈 상태 · 결과 네 가지를 모두 그린다.
 */

import { router, useFocusEffect, useScrollToTop } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/common/text';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtworkCard } from '@/components/common/artwork-card';
import { showToast } from '@/components/common/toast';
import { PressableScale } from '@/components/common/pressable-scale';
import { MuseumCard } from '@/components/home/museum-card';
import { FeedbackSheet } from '@/components/feedback/feedback-sheet';
import {
  ButtonGap,
  ButtonHeight,
  ButtonRadius,
  Charcoal,
  FontSize,
  MinTouchTarget,
  Mustard,
  getPalette,
  type Palette,
} from '@/constants/a11y';
import { Colors, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getArtworkByNumber, getMuseumArtworkPage, getMuseums } from '@/lib/api';
import { spokenNumbers } from '@/lib/spoken-answer';
import { useVoiceAnswer } from '@/hooks/use-voice-answer';
import { takePendingFeedback, type PendingFeedback } from '@/lib/pending-feedback';
import type { MuseumNext } from '@/types/museum';

const SearchBarHeight = 64;
/** 검색창을 누르면 이만큼 살짝 작아졌다가 놓으면 튕기듯 돌아온다. */
const PressedScale = 0.96;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SkeletonRows = 3;
const ArtworkPageSize = 20;

export default function HomeScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const { width: windowWidth } = useWindowDimensions();
  const browseGray = scheme === 'dark' ? Colors.dark.backgroundSelected : Charcoal;
  const bottomInset = useTabBarInset();
  const reduceMotion = useReducedMotion();
  const barScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: barScale.get() }] }));
  // With "Reduce motion" on, the bar does not shrink; the screen change itself is the feedback.
  const pressIn = () => {
    if (!reduceMotion) barScale.set(withTiming(PressedScale, { duration: 90 }));
  };
  const pressOut = () => {
    if (!reduceMotion) barScale.set(withSpring(1, { damping: 14, stiffness: 320 }));
  };
  const { settings, loaded } = useSettings();
  const museumId = settings.recent_museum_id;
  const museumsRes = useResource('museums', getMuseums);
  const [pagination, setPagination] = useState<{ museumId: string | null; page: number }>({ museumId: null, page: 1 });
  const page = pagination.museumId === museumId ? pagination.page : 1;
  const artworksRes = useResource(museumId ? `artworks:${museumId}:${page}` : null,
    () => getMuseumArtworkPage(museumId!, (page - 1) * ArtworkPageSize, ArtworkPageSize));
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // 해설을 끝까지 듣고 홈으로 돌아오면 감상 피드백 팝업을 한 번 띄운다.
  const [feedback, setFeedback] = useState<PendingFeedback | null>(null);
  useFocusEffect(useCallback(() => {
    const next = takePendingFeedback();
    if (next) setFeedback(next);
  }, []));
  useScrollToTop(scroll);
  const listY = useRef(0);

  const museum = museumsRes.data?.find((m) => m.id === museumId);
  const previousPage = museumId && artworksRes.previousKey?.startsWith(`artworks:${museumId}:`) ? artworksRes.previousData : undefined;
  const displayedPage = artworksRes.data ?? previousPage;
  const artworks = displayedPage?.items;
  const works = artworks ?? [];
  const total = displayedPage?.total ?? 0;
  const pageLoading = !!museumId && !artworksRes.data && !!displayedPage;
  const totalPages = Math.max(1, Math.ceil(total / ArtworkPageSize));
  // 저시력 사용자가 숫자를 크게 보고 누를 수 있도록 휴대폰에서는 3개, 넓은 화면에서는 5개만 보여 준다.
  const visiblePageCount = windowWidth < 480 ? 3 : 5;
  const firstPage = Math.min(Math.max(1, page - Math.floor(visiblePageCount / 2)), Math.max(1, totalPages - visiblePageCount + 1));
  const visiblePages = Array.from({ length: Math.min(visiblePageCount, totalPages) }, (_, index) => firstPage + index);
  const movePage = (next: number) => {
    if (!museumId || next < 1 || next > totalPages || next === page) return;
    setPagination({ museumId, page: next });
    requestAnimationFrame(() => scroll.current?.scrollTo({ y: listY.current, animated: true }));
  };
  const failed = !!museumsRes.error || !!artworksRes.error;
  const retry = () => {
    museumsRes.reload();
    artworksRes.reload();
  };

  // 음성으로 찾기: 번호("12번", "십이")나 제목·작가 이름을 말하면 현재 미술관에서 찾아 연다.
  const voice = useVoiceAnswer('artwork');
  const findByVoice = () => {
    // 미술관을 고른 적이 없을 때만 고르라고 한다. 고른 미술관의 목록을 받는 중이면 그렇게 알려 준다.
    if (!museumId) {
      showToast('먼저 미술관을 골라 주세요', 'warning');
      return;
    }
    if (!artworks) {
      showToast(artworksRes.error ? '작품 목록을 불러오지 못했어요. 다시 시도해 주세요' : '작품 목록을 불러오는 중이에요. 잠시 후 다시 눌러 주세요', 'warning');
      if (artworksRes.error) artworksRes.reload();
      return;
    }
    voice.startHolding({
      onText: async (text) => {
        const numbers = spokenNumbers(text);
        const squash = (value: string) => value.replace(/[\s.,·:;'"!?()-]/g, '').toLowerCase();
        const said = squash(text);
        const byNumber = works.find((a) => a.number && numbers.includes(String(Number(a.number))));
        const byName = said.length >= 2 ? works.find((a) => [a.title, a.original_title, a.artist, a.original_artist]
          .some((name) => name && (squash(name).includes(said) || said.includes(squash(name))))) : undefined;
        let found = byNumber ?? byName;
        // Only the first pages are loaded; a spoken number may belong to a work further down.
        for (const number of found ? [] : numbers) {
          try {
            found = await getArtworkByNumber(museumId, number.padStart(2, '0'));
            break;
          } catch {
            // Try the next number that was heard.
          }
        }
        if (found) {
          showToast('작품을 열어요', 'success');
          openArtwork(found.id);
        } else {
          showToast(text ? `"${text}"(으)로 들었어요. 맞는 작품을 찾지 못했어요` : '잘 들리지 않았어요. 다시 말해 주세요', 'warning');
        }
      },
      onError: (message) => showToast(message, 'warning'),
    });
  };

  const openPicker = (next?: MuseumNext) =>
    router.push(next ? { pathname: '/museum', params: { next } } : '/museum');
  const openArtwork = (id: string) => router.push({ pathname: '/artwork/[id]', params: { id } });

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      >
        {loaded && (!museumId || museumsRes.data) ? (
          <MuseumCard museum={museum} palette={palette} onChange={() => openPicker()} />
        ) : (
          <View style={[styles.skeletonCard, { backgroundColor: palette.fill }]} />
        )}

        {/* Long search bar with the same corner radius as every other box on this screen. Only the
            number search lives in it; the other ways to find get their own row below. */}
        <AnimatedPressable
          accessibilityRole="search"
          accessibilityLabel="작품 번호로 찾기"
          accessibilityHint="검색 화면이 열려요"
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={() => router.push('/search')}
          style={[
            styles.searchBar,
            { backgroundColor: palette.surface, borderColor: palette.accent },
            pressStyle,
          ]}>
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={24}
            weight="semibold"
            tintColor={palette.text}
          />
          <Text numberOfLines={1} style={[styles.searchHint, { color: palette.textSecondary }]}>
            작품 번호로 찾기
          </Text>
        </AnimatedPressable>

        <View style={styles.ways}>
          <WayButton
            ios="camera"
            android="photo_camera"
            label="카메라로 찾기"
            hint="QR 코드나 작품 사진으로 찾아요"
            palette={palette}
            onPress={() => router.navigate('/camera')}
          />
          <WayButton
            ios={voice.state === 'recording' ? 'stop.fill' : 'mic'}
            android={voice.state === 'recording' ? 'stop' : 'mic'}
            label={voice.state === 'recording' ? '듣고 있어요' : voice.state === 'thinking' ? '알아듣는 중…' : '음성으로 찾기'}
            hint="누른 채로 작품 번호나 제목을 말하고, 다 말하면 손을 떼 주세요"
            palette={palette}
            onPressIn={findByVoice}
            onPressOut={voice.stopHolding}
          />
        </View>

        <View onLayout={(event) => { listY.current = event.nativeEvent.layout.y; }} style={[styles.section, sectionSurface(palette)]}>
          <View style={styles.listHeader}>
            <View style={styles.listTitleRow}>
              <Text accessibilityRole="header" style={[styles.listTitle, { color: palette.text }]}>
                작품 목록
              </Text>
              {!!museum && artworks && (
                <Text style={[styles.count, { color: palette.textSecondary }]}>
                  {total}점
                </Text>
              )}
            </View>
            {!!museum && !!artworks?.length && (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="크게 넘겨보기"
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityHint="작품을 한 점씩 크게 보며 넘겨요"
                onPress={() => router.push('/browse')}
                style={({ pressed }) => [
                  styles.browse,
                  // Dark gray with white text (12:1 light, 10:1 dark); the › is the point color.
                  { backgroundColor: browseGray, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.browseText, { color: '#FFFFFF' }]}>크게 넘겨보기</Text>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={18}
                  weight="bold"
                  tintColor={Mustard}
                />
              </PressableScale>
            )}
          </View>

          {failed ? (
            <View style={[styles.messageBox, { backgroundColor: palette.surface }]}>
              <Text accessibilityRole="alert" style={[styles.messageText, { color: palette.text }]}>
                작품 목록을 불러오지 못했어요
              </Text>
              <PillButton label="다시 시도" palette={palette} onPress={retry} />
            </View>
          ) : loaded && !museumId ? (
            <View style={[styles.messageBox, { backgroundColor: palette.surface }]}>
              <Text style={[styles.messageText, { color: palette.textSecondary }]}>
                미술관을 고르면 작품 목록이 보여요
              </Text>
              <PillButton
                label="미술관 선택하기"
                palette={palette}
                onPress={() => openPicker('list')}
              />
            </View>
          ) : !artworks ? (
            <View
              accessible
              accessibilityLabel="작품 목록을 불러오는 중"
              style={styles.skeletonList}>
              {Array.from({ length: SkeletonRows }, (_, i) => (
                <View key={i} style={[styles.skeletonRow, { backgroundColor: palette.fill }]} />
              ))}
            </View>
          ) : works.length === 0 ? (
            <Text style={[styles.none, { color: palette.textSecondary }]}>
              이 미술관에 등록된 작품이 없어요
            </Text>
          ) : (
            // 목록은 한 덩어리로 묶고(바깥 gap이 행 사이에 끼지 않게), 구분선 위아래 여백을 같게 둔다.
            // 그래야 누를 때 생기는 회색 상자가 위아래 구분선 사이 한가운데에 온다.
            <View>
              <View style={styles.pageItems}>
                <View style={{ opacity: pageLoading ? 0.24 : 1 }}>
                  {works.map((a, i) => (
                    <View key={a.id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                      <ArtworkCard artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
                    </View>
                  ))}
                </View>
                {pageLoading && <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={`${page}페이지 작품을 불러오는 중`}
                  style={[styles.pageLoading, { backgroundColor: `${palette.surface}F2` }]}
                >
                  <ActivityIndicator size="large" color={palette.highlight} />
                  <Text style={[styles.pageLoadingText, { color: palette.text }]}>{page}페이지 불러오는 중…</Text>
                </View>}
              </View>
              {totalPages > 1 && <View accessibilityRole="toolbar" accessibilityLabel="작품 목록 페이지" style={styles.pagination}>
                <PageLink label="‹" accessibilityLabel="이전 페이지" disabled={page === 1} palette={palette} onPress={() => movePage(page - 1)} />
                {visiblePages.map((number) => <PageLink key={number} label={String(number)} accessibilityLabel={`${number}페이지`} selected={number === page}
                  palette={palette} onPress={() => movePage(number)} />)}
                <PageLink label="›" accessibilityLabel="다음 페이지" disabled={page === totalPages} palette={palette} onPress={() => movePage(page + 1)} />
              </View>}
            </View>
          )}
        </View>
      </ScrollView>
      {feedback && <FeedbackSheet key={feedback.artworkId} item={feedback} palette={palette} onClose={() => setFeedback(null)} />}
    </SafeAreaView>
  );
}

function sectionSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.outline };
}

function PageLink({ label, accessibilityLabel, selected = false, disabled = false, palette, onPress }: {
  label: string;
  accessibilityLabel: string;
  selected?: boolean;
  disabled?: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled }}
    disabled={disabled} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.pageLink, { opacity: disabled ? 0.3 : pressed ? 0.55 : 1 }]}
  >
    <Text style={[styles.pageText, (label === '‹' || label === '›') && styles.pageArrow,
      { color: selected ? palette.highlight : palette.text, fontWeight: selected ? 900 : 800 }, selected && styles.pageSelected]}>{label}</Text>
  </Pressable>;
}

type WayButtonProps = {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  hint?: string;
  palette: Palette;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
};

/**
 * 검색창 아래 반반 칸. 아이콘을 글자 위에 두어 글자가 칸 너비를 다 쓴다(옆에 두면 반 칸에서 글자가 줄어든다).
 * 글씨를 키우면 줄이지 않고 두 줄로 넘긴다.
 */
function WayButton({ ios, android, label, hint, palette, onPress, onPressIn, onPressOut }: WayButtonProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.way,
        sectionSurface(palette),
        // Held down: mustard with charcoal content, so you can see which one you pressed.
        pressed && { backgroundColor: palette.highlight, borderColor: palette.highlight },
      ]}>
      {({ pressed }) => (
        <>
          <View
            style={[
              styles.wayIcon,
              { backgroundColor: pressed ? palette.highlightText : palette.fill },
            ]}>
            <SymbolView
              name={{ ios, android, web: android }}
              size={26}
              weight="medium"
              tintColor={pressed ? palette.highlight : palette.text}
            />
          </View>
          <Text
            numberOfLines={2}
            style={[styles.wayLabel, { color: pressed ? palette.highlightText : palette.text }]}>
            {label}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

function PillButton({
  label,
  palette,
  onPress,
}: {
  label: string;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.pillText, { color: palette.accentText }]}>{label}</Text>
    </PressableScale>
  );
}

// Every box on the home screen (museum card, search bar, ways, list) shares this radius.
const BoxRadius = 24;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
  },
  // One card per section, like the Toss home. The outline is 3:1 against the page.
  section: {
    gap: 12,
    padding: Spacing.three,
    borderWidth: 1.5,
    borderRadius: BoxRadius,
  },
  divider: {
    height: 1.5,
    marginVertical: 6,
  },
  pageItems: { position: 'relative', minHeight: 120 },
  pageLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderRadius: 18 },
  pageLoadingText: { fontSize: FontSize.label, lineHeight: 28, fontWeight: 800, textAlign: 'center' },
  skeletonCard: {
    height: 96,
    borderRadius: 24,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: SearchBarHeight,
    paddingHorizontal: 22,
    borderWidth: 2,
    borderRadius: BoxRadius,
  },
  searchHint: {
    flexShrink: 1,
    fontSize: FontSize.body,
    fontWeight: 700,
  },
  // Two equal halves under the search bar.
  ways: {
    flexDirection: 'row',
    gap: ButtonGap,
  },
  way: {
    flexGrow: 1,
    flexBasis: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: MinTouchTarget + 8,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderRadius: BoxRadius,
  },
  wayIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wayLabel: {
    fontSize: FontSize.label,
    lineHeight: 24,
    fontWeight: 700,
    textAlign: 'center',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginHorizontal: Spacing.one,
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  // 보이는 높이는 48로 낮추되, 위아래 hitSlop으로 누르는 영역은 56을 지킨다.
  browse: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browseText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  listTitle: {
    fontSize: FontSize.heading,
    fontWeight: 800,
  },
  count: {
    fontSize: FontSize.label,
    fontWeight: 600,
  },
  messageBox: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  messageText: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
  pill: {
    minHeight: ButtonHeight,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: -Spacing.three, paddingTop: Spacing.three },
  pageLink: { width: MinTouchTarget, minHeight: MinTouchTarget, alignItems: 'center', justifyContent: 'center' },
  pageText: { fontSize: 28, lineHeight: 36, fontVariant: ['tabular-nums'], textAlign: 'center' },
  pageArrow: { fontSize: 38, lineHeight: 44 },
  pageSelected: { textDecorationLine: 'underline' },
  skeletonList: {
    gap: Spacing.three,
  },
  skeletonRow: {
    height: 68,
    borderRadius: 20,
  },
  none: {
    padding: Spacing.four,
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
});
