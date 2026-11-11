// 와이어프레임 1 홈 (작품 선택). 번호 입력(1-1)은 검색 화면(`/search`)으로 옮겼다
/**
 * 현재 미술관 카드 → 길고 둥근 검색창(네이버처럼. 누르면 검색 화면) → 그 아래 반반 두 칸
 * (카메라로 찾기 · 음성으로 찾기)
 * → 작품 목록 카드(토스처럼 카드로 묶음, 테두리는 배경과 3:1 이상).
 * 목록은 불러오는 중 · 오류 · 빈 상태 · 결과 네 가지를 모두 그린다.
 */

import { useEffect } from 'react';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { MuseumCard } from '@/components/home/museum-card';
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
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { MuseumNext } from '@/types/museum';

const SearchBarHeight = 64;
/** 검색창을 누르면 이만큼 살짝 작아졌다가 놓으면 튕기듯 돌아온다. */
const PressedScale = 0.96;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SkeletonRows = 3;

export default function HomeScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
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
  const { settings, loaded, updateSettings } = useSettings();
  const museumId = settings.recent_museum_id;
  const museumsRes = useResource('museums', getMuseums);
  const artworksRes = useResource(museumId, () => getMuseumArtworks(museumId!));

  useEffect(() => {
    const museums = museumsRes.data;
    if (loaded && museums?.length && !museums.some((m) => m.id === museumId)) {
      void updateSettings({ recent_museum_id: museums[0].id });
    }
  }, [loaded, museumId, museumsRes.data, updateSettings]);

  const museum = museumsRes.data?.find((m) => m.id === museumId);
  const artworks = artworksRes.data;
  const works = artworks ?? [];
  const failed = !!museumsRes.error || !!artworksRes.error;
  const retry = () => {
    museumsRes.reload();
    artworksRes.reload();
  };

  const openPicker = (next?: MuseumNext) =>
    router.push(next ? { pathname: '/museum', params: { next } } : '/museum');
  const openArtwork = (id: string) => router.push({ pathname: '/artwork/[id]', params: { id } });

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        {loaded && (!museumId || museumsRes.data) ? (
          <MuseumCard museum={museum} palette={palette} onChange={() => openPicker()} />
        ) : (
          <View style={[styles.skeletonCard, { backgroundColor: palette.fill }]} />
        )}

        {/* Long, fully round search bar (Naver). Only the number search lives in it; the other
            ways to find get their own row below, so the bar is not crammed with icons. */}
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
            size={22}
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
            ios="mic"
            android="mic"
            label="음성으로 찾기"
            palette={palette}
            onPress={() => showToast('음성으로 찾기는 준비 중이에요')}
          />
        </View>

        <View style={[styles.section, sectionSurface(palette)]}>
          <View style={styles.listHeader}>
            <View style={styles.listTitleRow}>
              <Text accessibilityRole="header" style={[styles.listTitle, { color: palette.text }]}>
                작품 목록
              </Text>
              {!!museum && artworks && (
                <Text style={[styles.count, { color: palette.textSecondary }]}>
                  {works.length}점
                </Text>
              )}
            </View>
            {!!museum && !!artworks?.length && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="크게 넘겨보기"
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
              </Pressable>
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
            works.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                <ArtworkCard artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function sectionSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.outline };
}

type WayButtonProps = {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  hint?: string;
  palette: Palette;
  onPress: () => void;
};

/** 검색창 아래 반반 칸. 아이콘은 가는 선 모양으로 작게, 옅은 원 안에 여유 있게 둔다. */
function WayButton({ ios, android, label, hint, palette, onPress }: WayButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
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
              size={20}
              weight="medium"
              tintColor={pressed ? palette.highlight : palette.text}
            />
          </View>
          <Text
            style={[styles.wayLabel, { color: pressed ? palette.highlightText : palette.text }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
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
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.pillText, { color: palette.accentText }]}>{label}</Text>
    </Pressable>
  );
}

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
    borderRadius: 24,
  },
  divider: {
    height: 1.5,
  },
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
    borderRadius: SearchBarHeight / 2,
  },
  searchHint: {
    flexShrink: 1,
    fontSize: FontSize.label,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MinTouchTarget + 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: 20,
  },
  wayIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wayLabel: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: 700,
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
  // Slim (44, the minimum tap size) so it reads as a header action, not a main button.
  browse: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browseText: {
    fontSize: 16,
    fontWeight: 800,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: 800,
  },
  count: {
    fontSize: 16,
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
    fontSize: 17,
    fontWeight: 800,
  },
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
