// 와이어프레임 1 홈 (작품 선택) + 1-1 번호 입력 (디자인 "저시력 미술관 앱"에서 홈에 합쳐짐)
/**
 * 카드 세 개로 나눈다 (토스 홈처럼): 현재 미술관 → 작품 찾기(번호 입력이 주 동작, 가장 크게,
 * 아래에 QR·카메라 바로가기) → 작품 목록. 카드 테두리는 배경과 3:1 이상이라 저시력에도 경계가 보인다.
 * 번호를 입력하면 목록이 바로 걸러진다. 미술관을 고르지 않았으면 입력칸 자리에
 * "미술관을 먼저 골라 주세요" 버튼을 두고, 누르면 1-0으로 간다 (포커스만으로는 화면을 바꾸지 않는다).
 * 목록은 불러오는 중 · 오류 · 빈 상태 · 결과 네 가지를 모두 그린다.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtworkCard } from '@/components/common/artwork-card';
import { showToast } from '@/components/common/toast';
import { MuseumCard } from '@/components/home/museum-card';
import {
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
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Artwork } from '@/types/artwork';
import type { MuseumNext } from '@/types/museum';

const InputHeight = 72;
const SkeletonRows = 3;

/** "1"은 01, 11, 12…와 맞고, "12"는 12와 맞는다. */
function matchesNumber(artwork: Artwork, query: string) {
  return artwork.number.includes(query) || String(Number(artwork.number)).startsWith(query);
}

export default function HomeScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { settings, loaded } = useSettings();
  const museumId = settings.recent_museum_id;
  const museumsRes = useResource('museums', getMuseums);
  const artworksRes = useResource(museumId, () => getMuseumArtworks(museumId!));
  const inputRef = useRef<TextInputInstance>(null);
  const [num, setNum] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const museum = museumsRes.data?.find((m) => m.id === museumId);
  const artworks = artworksRes.data;
  const works = (artworks ?? []).filter((a) => !num || matchesNumber(a, num));
  const failed = !!museumsRes.error || !!artworksRes.error;
  const retry = () => {
    museumsRes.reload();
    artworksRes.reload();
  };

  // Coming back from 1-0 after "번호 입력": continue where the user meant to go.
  useEffect(() => {
    if (focus !== 'number') return;
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    router.setParams({ focus: undefined });
    return () => clearTimeout(t);
  }, [focus]);

  // The museum changed, so an old number no longer means anything.
  const [numFor, setNumFor] = useState(museumId);
  if (numFor !== museumId) {
    setNumFor(museumId);
    setNum('');
  }

  const openPicker = (next?: MuseumNext) => {
    inputRef.current?.blur();
    router.push(next ? { pathname: '/museum', params: { next } } : '/museum');
  };

  const openArtwork = (id: string) => router.push({ pathname: '/artwork/[id]', params: { id } });

  /**
   * 검색 버튼과 키보드의 "검색" 키. 번호가 정확히 맞거나 하나만 남으면 그 작품으로 가고,
   * 아니면 왜 못 갔는지 알려 준다 (토스트는 스크린리더에도 읽힌다).
   */
  const onSubmitNumber = () => {
    if (!num) {
      inputRef.current?.focus();
      showToast('작품 옆 명패의 번호를 먼저 입력해 주세요', 'warning');
      return;
    }
    const exact = works.find((a) => Number(a.number) === Number(num));
    const target = exact ?? (works.length === 1 ? works[0] : undefined);
    if (target) openArtwork(target.id);
    else if (works.length === 0)
      showToast(`${num}번 작품이 없어요. 번호를 확인해 주세요`, 'warning');
    else
      showToast(`${num}(으)로 시작하는 작품이 여러 개예요. 번호를 끝까지 입력해 주세요`, 'warning');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        {loaded && (!museumId || museumsRes.data) ? (
          <MuseumCard museum={museum} palette={palette} onChange={() => openPicker()} />
        ) : (
          <View style={[styles.skeletonCard, { backgroundColor: palette.fill }]} />
        )}

        <View style={[styles.section, sectionSurface(palette)]}>
          {/* A visible label: the placeholder disappears as soon as a number is typed. */}
          <Text
            nativeID="number-label"
            style={[styles.inputLabel, { color: palette.text }]}
            onPress={() => inputRef.current?.focus()}>
            작품 옆 명패 번호를 입력해 주세요
          </Text>
          <View style={styles.findRow}>
            {/* A transparent ring that only takes a color on focus, so the field never changes size. */}
            <View
              style={[styles.ring, { borderColor: inputFocused ? palette.text : 'transparent' }]}>
              {loaded && !museumId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="작품 번호 입력. 먼저 미술관을 골라야 해요"
                  onPress={() => openPicker('number')}
                  style={({ pressed }) => [
                    styles.field,
                    styles.fieldButton,
                    inputSurface(palette),
                    pressed && { backgroundColor: palette.fill },
                  ]}>
                  <Text style={[styles.fieldHint, { color: palette.textSecondary }]}>
                    미술관을 먼저 골라 주세요
                  </Text>
                </Pressable>
              ) : (
                // The search button sits inside the field: it acts on this field's value.
                <View style={[styles.fieldBox, inputSurface(palette)]}>
                  <TextInput
                    ref={inputRef}
                    accessibilityLabelledBy="number-label"
                    accessibilityLabel="작품 번호 입력"
                    accessibilityHint="번호를 입력하면 목록이 걸러져요"
                    placeholder="번호"
                    placeholderTextColor={palette.textSecondary}
                    keyboardType="number-pad"
                    returnKeyType="search"
                    maxLength={3}
                    value={num}
                    onChangeText={(v) => setNum(v.replace(/\D/g, ''))}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    onSubmitEditing={onSubmitNumber}
                    style={[styles.fieldInput, { color: palette.text }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="작품 번호로 찾기"
                    onPress={onSubmitNumber}
                    style={({ pressed }) => [
                      styles.search,
                      { backgroundColor: palette.fill, opacity: pressed ? 0.7 : 1 },
                    ]}>
                    <SymbolView
                      name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                      size={26}
                      weight="bold"
                      tintColor={palette.text}
                    />
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="음성으로 작품 찾기"
              // README 3장: 음성 인식은 Expo Go에서 안 돼 기능은 P2. 버튼만 둔다.
              onPress={() => showToast('음성으로 찾기는 준비 중이에요')}
              style={({ pressed }) => [
                styles.mic,
                { backgroundColor: palette.fill, opacity: pressed ? 0.8 : 1 },
              ]}>
              <SymbolView
                name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
                size={28}
                tintColor={palette.text}
              />
            </Pressable>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.fill }]} />
          <View style={styles.shortcuts}>
            <Shortcut
              label="QR로 찾기"
              icon={{ ios: 'qrcode.viewfinder', android: 'qr_code_scanner' }}
              palette={palette}
              onPress={() => router.push({ pathname: '/capture', params: { mode: 'qr' } })}
            />
            <View style={[styles.shortcutBar, { backgroundColor: palette.outline }]} />
            <Shortcut
              label="카메라로 찾기"
              icon={{ ios: 'camera.fill', android: 'photo_camera' }}
              palette={palette}
              onPress={() => router.push({ pathname: '/capture', params: { mode: 'artwork' } })}
            />
          </View>
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
                  // Point color: mustard fill with charcoal text (7.2:1 light, 8.2:1 dark).
                  { backgroundColor: palette.highlight, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.browseText, { color: palette.highlightText }]}>
                  크게 넘겨보기
                </Text>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={18}
                  weight="bold"
                  tintColor={palette.highlightText}
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
              {num ? `${num}번 작품이 없어요` : '이 미술관에 등록된 작품이 없어요'}
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

type ShortcutProps = {
  label: string;
  icon: { ios: SFSymbol; android: AndroidSymbol };
  palette: Palette;
  onPress: () => void;
};

/** 작품 찾기 카드 아래의 바로가기 한 칸 (토스의 "계좌 | 대출 | 카드" 줄). */
function Shortcut({ label, icon, palette, onPress }: ShortcutProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.shortcut, pressed && { backgroundColor: palette.fill }]}>
      <SymbolView name={{ ...icon, web: icon.android }} size={22} tintColor={palette.text} />
      <Text style={[styles.shortcutText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function inputSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.border };
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
  shortcuts: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: -Spacing.one,
  },
  shortcut: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: ButtonHeight,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shortcutText: {
    fontSize: 17,
    fontWeight: 700,
  },
  shortcutBar: {
    width: 1.5,
    height: 24,
  },
  skeletonCard: {
    height: 96,
    borderRadius: 24,
  },
  inputLabel: {
    marginBottom: -Spacing.one,
    marginHorizontal: Spacing.one,
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  findRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ring: {
    flex: 1,
    padding: 2,
    borderWidth: 3,
    borderRadius: 26,
  },
  // Minimum, not fixed: a fixed height clips the number at the largest system text size.
  field: {
    minHeight: InputHeight,
    paddingVertical: 10,
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 20,
  },
  // Field with the search button inside. The left padding matches the button so the number
  // stays centered in the whole field, not just in the space left of the button.
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: InputHeight,
    borderWidth: 2,
    borderRadius: 20,
    paddingLeft: MinTouchTarget + 6,
    paddingRight: 6,
  },
  fieldInput: {
    flex: 1,
    minHeight: InputHeight - 4,
    paddingVertical: 8,
    fontSize: FontSize.heading,
    fontWeight: 800,
    textAlign: 'center',
  },
  search: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldHint: {
    fontSize: FontSize.label,
    fontWeight: 700,
  },
  mic: {
    width: InputHeight,
    height: InputHeight,
    borderRadius: InputHeight / 2,
    alignItems: 'center',
    justifyContent: 'center',
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
  browse: {
    minHeight: ButtonHeight,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browseText: {
    fontSize: 17,
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
