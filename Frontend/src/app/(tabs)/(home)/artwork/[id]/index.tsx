// 와이어프레임 2 작품 감상 → 디자인 "저시력 미술관 앱"의 작품 상세
/**
 * 위에서부터 큰 작품 이미지(보정 캔버스, 누르면 크게 보기) · 미술관과 번호 · 제목 · 작가 ·
 * 보정본/원본 전환 · 음성 해설 듣기(3 해설 재생 화면으로) · 작품 설명(글자 크기 조절) · 이전/다음 작품.
 * 이미지나 "확대"를 누르면 탭 바 없는 전체 화면(`/zoom/[id]`)에서 핀치·버튼으로 확대한다.
 * 보정본일 때는 그 아래 보정 강도(0~100%)로 얼마나 보정할지 고른다. 크게 보기에도 같은 강도로 넘긴다.
 * TODO(B): 영역 터치(regions, P1).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { StrengthControl } from '@/components/artwork/strength-control';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import {
  ButtonGap,
  ButtonHeight,
  ButtonRadius,
  FontSize,
  MinTouchTarget,
  getPalette,
  type Palette,
} from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { useHistory } from '@/hooks/use-history';
import { useRecordViewing } from '@/hooks/use-record-viewing';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { ApiError, getArtwork, getMuseumArtworks, getMuseums } from '@/lib/api';
import { addRecent } from '@/store/recent';

const HERO_HEIGHT = 380;
/** 작품 설명 글자 크기 단계. 가장 작은 단계도 본문 최소 크기(18) 이상 */
const DESC_SIZES = [18, 20, 23, 26];

export default function ArtworkScreen() {
  const { profile: currentProfile, loaded: profileLoaded, error: profileError } = useProfile();
  const { items: historyItems, loaded: historyLoaded, error: historyError } = useHistory();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { id, history: historyId } = useLocalSearchParams<{ id: string; history?: string }>();
  const historyRecord = historyItems.find((item) => item.id === historyId && item.artwork.id === id);
  const profile = historyRecord?.profile ?? currentProfile;
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const { data: museums } = useResource('museums', getMuseums);
  const museumId = artwork?.museum_id || null;
  const { data: siblings } = useResource(museumId, () => getMuseumArtworks(museumId!));
  const [original, setOriginal] = useState(false);
  const [chosenStrength, setStrength] = useState<number | null>(null);
  const strength = chosenStrength ?? profile.strength;
  const [sizeStep, setSizeStep] = useState(1);
  useRecordViewing(artwork, profile, strength, original, profileLoaded && !profileError, !historyId);

  // Remember it for the search screen's "최근 본 작품".
  useEffect(() => {
    if (artwork) void addRecent(artwork);
  }, [artwork]);

  const museum = museums?.find((m) => m.id === artwork?.museum_id);
  // Mustard text is too faint on the light background, so light mode uses the body text color.
  const metaColor = scheme === 'dark' ? palette.highlight : palette.text;
  const position = siblings?.findIndex((a) => a.id === artwork?.id) ?? -1;
  const prev = position > 0 ? siblings![position - 1] : undefined;
  const next =
    position >= 0 && siblings && position < siblings.length - 1
      ? siblings[position + 1]
      : undefined;
  const descSize = DESC_SIZES[sizeStep];

  const openNarration = () => {
    if (!artwork) return;
    router.push({ pathname: '/artwork/[id]/narration', params: { id: artwork.id } });
  };

  const openZoom = () => {
    if (!artwork) return;
    router.push({
      pathname: '/zoom/[id]',
      params: { id: artwork.id, original: original ? '1' : '0', strength: String(strength), ...(historyId ? { history: historyId } : {}) },
    });
  };

  // Replace, not push: back from a neighbour still goes to the list, not through every artwork seen.
  const openSibling = (target: { id: string }) =>
    router.replace({ pathname: '/artwork/[id]', params: { id: target.id } });

  if (error || !artwork || (historyId && (!historyLoaded || historyError || !historyRecord))) {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.plainHeader}>
          <BackButton label={historyId ? '관람 기록으로' : '작품 목록으로'} palette={palette} />
        </View>
        {(!!error || (historyId && historyLoaded)) && (
          <Text style={[styles.message, { color: palette.text }]}>
            {historyId && (historyError || !historyRecord) ? '관람 기록을 불러오지 못했어요. 관람 기록 화면에서 다시 선택해 주세요.' : error instanceof ApiError && error.status === 404
              ? '작품을 찾지 못했어요'
              : '작품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요'}
          </Text>
        )}
      </SafeAreaView>
    );
  }

  const description = artwork.description;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        <View style={styles.hero}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${artwork.title} 크게 보기`}
            accessibilityHint="전체 화면에서 확대해 볼 수 있어요"
            onPress={openZoom}>
            <CorrectionCanvas
              source={artwork.image_url}
              accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
              correction={{ ...profile, strength }}
              original={original}
              palette={palette}
              style={styles.heroCanvas}
            />
          </Pressable>
          <View style={styles.heroBack}>
            <BackButton label={historyId ? '관람 기록으로' : '작품 목록으로'} palette={palette} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="작품 확대해서 보기"
            onPress={openZoom}
            style={({ pressed }) => [styles.zoomButton, { opacity: pressed ? 0.8 : 1 }]}>
            <SymbolView
              name={{
                ios: 'plus.magnifyingglass',
                android: 'zoom_in',
                web: 'zoom_in',
              }}
              size={22}
              tintColor="#FFFFFF"
            />
            <Text style={styles.zoomText}>확대</Text>
          </Pressable>
        </View>

        <View style={styles.info}>
          <Text style={[styles.meta, { color: metaColor }]}>
            {[museum?.name, artwork.number && `No. ${artwork.number}`].filter(Boolean).join(' · ')}
          </Text>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
            {artwork.title}
          </Text>
          <Text style={[styles.artist, { color: palette.textSecondary }]}>
            {[artwork.artist, artwork.year].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View accessibilityRole="radiogroup" accessibilityLabel="보기 방식" style={styles.toggle}>
          {/* Each button sits in an equal half, and BigButton reserves the ✓ slot itself,
              so selecting never resizes a button or moves its label. */}
          <View style={styles.toggleItem}>
            <BigButton
              label="보정본"
              radio
              onPress={() => setOriginal(false)}
              palette={palette}
              selected={!original}
            />
          </View>
          <View style={styles.toggleItem}>
            <BigButton
              label="원본 보기"
              radio
              onPress={() => setOriginal(true)}
              palette={palette}
              selected={original}
            />
          </View>
        </View>

        <View style={styles.strength}>
          <StrengthControl
            value={strength}
            disabled={original}
            palette={palette}
            onChange={setStrength}
          />
        </View>

        {/* Always shown: the narration screen explains when there is no reviewed narration yet. */}
        <View style={styles.audioRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="음성 해설 듣기"
            accessibilityHint="한 문장씩 읽어 주는 화면이 열려요"
            onPress={openNarration}
            style={({ pressed }) => [
              styles.audio,
              { backgroundColor: palette.accent, borderColor: palette.accent },
              { opacity: pressed ? 0.8 : 1 },
            ]}>
            <SymbolView
              name={{ ios: 'headphones', android: 'headphones', web: 'headphones' }}
              size={22}
              tintColor={palette.accentText}
            />
            <Text style={[styles.audioText, { color: palette.accentText }]}>음성 해설 듣기</Text>
          </Pressable>
        </View>

        <View style={styles.descHeader}>
          <Text accessibilityRole="header" style={[styles.descTitle, { color: palette.text }]}>
            작품 설명
          </Text>
          <View style={styles.sizeButtons}>
            <SizeButton
              label="가−"
              a11yLabel="글자 작게"
              small
              disabled={sizeStep === 0}
              palette={palette}
              onPress={() => setSizeStep((s) => Math.max(0, s - 1))}
            />
            <SizeButton
              label="가+"
              a11yLabel="글자 크게"
              disabled={sizeStep === DESC_SIZES.length - 1}
              palette={palette}
              onPress={() => setSizeStep((s) => Math.min(DESC_SIZES.length - 1, s + 1))}
            />
          </View>
        </View>

        <View style={styles.desc}>
          {description ? (
            <>
              <Text
                style={[
                  styles.descText,
                  {
                    color: palette.text,
                    fontSize: descSize,
                    lineHeight: descSize * 1.7,
                  },
                ]}>
                {description.facts.join(' ')}
              </Text>
              {description.interpretations.length > 0 && (
                <>
                  <Text style={[styles.descLabel, { color: palette.textSecondary }]}>
                    느낌과 해석
                  </Text>
                  <Text
                    style={[
                      styles.descText,
                      {
                        color: palette.text,
                        fontSize: descSize,
                        lineHeight: descSize * 1.7,
                      },
                    ]}>
                    {description.interpretations.join(' ')}
                  </Text>
                </>
              )}
            </>
          ) : (
            <>
              {!!artwork.background && (
                <Text
                  style={[
                    styles.descText,
                    {
                      color: palette.text,
                      fontSize: descSize,
                      lineHeight: descSize * 1.7,
                    },
                  ]}>
                  {artwork.background}
                </Text>
              )}
              <Text
                style={[styles.descPending, { color: palette.textSecondary, fontSize: descSize }]}>
                아직 해설이 준비되지 않았어요
              </Text>
            </>
          )}
        </View>

        {(prev || next) && (
          <View style={styles.siblings}>
            <SiblingButton
              direction="prev"
              label="이전 작품"
              a11yLabel={prev ? `이전 작품, ${prev.title}` : '이전 작품 없음'}
              disabled={!prev}
              palette={palette}
              onPress={() => prev && openSibling(prev)}
            />
            <SiblingButton
              direction="next"
              label="다음 작품"
              a11yLabel={next ? `다음 작품, ${next.title}` : '다음 작품 없음'}
              disabled={!next}
              palette={palette}
              onPress={() => next && openSibling(next)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type SmallButtonProps = {
  label: string;
  a11yLabel: string;
  disabled: boolean;
  palette: Palette;
  onPress: () => void;
};

function SizeButton({ small, ...p }: SmallButtonProps & { small?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.a11yLabel}
      accessibilityState={{ disabled: p.disabled }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={({ pressed }) => [
        styles.size,
        {
          backgroundColor: p.palette.fill,
          opacity: p.disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}>
      <Text style={[styles.sizeText, { color: p.palette.text, fontSize: small ? 16 : 20 }]}>
        {p.label}
      </Text>
    </Pressable>
  );
}

function SiblingButton({ direction, ...p }: SmallButtonProps & { direction: 'prev' | 'next' }) {
  const chevron = (
    <SymbolView
      name={
        direction === 'prev'
          ? { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }
          : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
      }
      size={18}
      weight="bold"
      tintColor={p.palette.text}
    />
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.a11yLabel}
      accessibilityState={{ disabled: p.disabled }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={({ pressed }) => [
        styles.sibling,
        {
          backgroundColor: p.palette.fill,
          opacity: p.disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}>
      {direction === 'prev' && chevron}
      <Text style={[styles.siblingText, { color: p.palette.text }]}>{p.label}</Text>
      {direction === 'next' && chevron}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  plainHeader: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
  },
  hero: {
    height: HERO_HEIGHT,
  },
  heroCanvas: {
    height: HERO_HEIGHT,
    borderRadius: 0,
    borderWidth: 0,
  },
  heroBack: {
    position: 'absolute',
    left: Spacing.three,
    top: Spacing.two,
  },
  // Fixed dark scrim: the button sits on the artwork image, not on the app background.
  zoomButton: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.two,
    minHeight: ButtonHeight,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  zoomText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 800,
  },
  info: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: Spacing.four,
  },
  meta: {
    fontSize: 16,
    fontWeight: 700,
    textAlign: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 38,
    textAlign: 'center',
  },
  artist: {
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
  toggle: {
    flexDirection: 'row',
    gap: ButtonGap,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.four,
  },
  // flexBasis 0: both halves start from zero width and split the row evenly, whatever the label.
  toggleItem: {
    flexGrow: 1,
    flexBasis: 0,
  },
  strength: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
  },
  audioRow: {
    alignItems: 'center',
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
  },
  // Heights are minimums: a fixed height clips the words at the largest system text size.
  audio: {
    alignSelf: 'stretch',
    minHeight: ButtonHeight,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: ButtonRadius,
    borderWidth: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  audioText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  descHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: Spacing.two,
  },
  descTitle: {
    fontSize: FontSize.body,
    fontWeight: 800,
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  size: {
    minWidth: MinTouchTarget,
    minHeight: MinTouchTarget,
    paddingHorizontal: 8,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeText: {
    fontWeight: 800,
  },
  desc: {
    gap: Spacing.two,
    paddingHorizontal: 20,
  },
  descText: {
    fontWeight: 500,
  },
  descLabel: {
    marginTop: Spacing.two,
    fontSize: 16,
    fontWeight: 800,
  },
  descPending: {
    fontWeight: 600,
    lineHeight: 30,
  },
  siblings: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: ButtonGap,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.four,
  },
  // Equal halves like the 보정본/원본 pair, whatever the label.
  sibling: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: ButtonHeight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  siblingText: {
    fontSize: 17,
    fontWeight: 700,
  },
  message: {
    padding: Spacing.four,
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
});
