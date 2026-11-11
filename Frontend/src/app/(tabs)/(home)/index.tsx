// 와이어프레임 1 홈 (작품 선택). 번호 입력(1-1)은 검색 화면(`/search`)으로 옮겼다
/**
 * 현재 미술관 카드 → 길고 둥근 검색창(네이버처럼. 누르면 검색 화면) → 그 아래 반반 두 칸
 * (카메라로 찾기 · 음성으로 찾기)
 * → 작품 목록 카드(토스처럼 카드로 묶음, 테두리는 배경과 3:1 이상).
 * 목록은 불러오는 중 · 오류 · 빈 상태 · 결과 네 가지를 모두 그린다.
 */

import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { spokenNumbers } from '@/lib/spoken-answer';
import { useVoiceAnswer } from '@/hooks/use-voice-answer';
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
  const { settings, loaded } = useSettings();
  const museumId = settings.recent_museum_id;
  const museumsRes = useResource('museums', getMuseums);
  const artworksRes = useResource(museumId, () => getMuseumArtworks(museumId!));

  const museum = museumsRes.data?.find((m) => m.id === museumId);
  const artworks = artworksRes.data;
  const works = artworks ?? [];
  const failed = !!museumsRes.error || !!artworksRes.error;
  const retry = () => {
    museumsRes.reload();
    artworksRes.reload();
  };

  // 음성으로 찾기: 번호("12번", "십이")나 제목·작가 이름을 말하면 현재 미술관에서 찾아 연다.
  const voice = useVoiceAnswer();
  const findByVoice = () => {
    if (!museum || !artworks) {
      showToast('먼저 미술관을 골라 주세요', 'warning');
      return;
    }
    voice.toggle({
      onText: (text) => {
        const numbers = spokenNumbers(text);
        const squash = (value: string) => value.replace(/[\s.,·:;'"!?()-]/g, '').toLowerCase();
        const said = squash(text);
        const byNumber = works.find((a) => a.number && numbers.includes(String(Number(a.number))));
        const byName = said.length >= 2 ? works.find((a) => [a.title, a.original_title, a.artist, a.original_artist]
          .some((name) => name && (squash(name).includes(said) || said.includes(squash(name))))) : undefined;
        const found = byNumber ?? byName;
        if (found) {
          showToast(`"${found.title}" 작품을 열어요`, 'success');
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
            ios={voice.state === 'recording' ? 'stop.fill' : 'mic'}
            android={voice.state === 'recording' ? 'stop' : 'mic'}
            label={voice.state === 'recording' ? '듣고 있어요' : voice.state === 'thinking' ? '알아듣는 중…' : '음성으로 찾기'}
            hint={voice.state === 'recording' ? '다 말했으면 누르세요' : '작품 번호나 제목을 말해 주세요'}
            palette={palette}
            onPress={findByVoice}
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
              {works.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                  <ArtworkCard artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
                </View>
              ))}
            </View>
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
    <PressableScale
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
    marginVertical: 6,
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
    fontSize: FontSize.label,
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
    fontSize: 22,
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
