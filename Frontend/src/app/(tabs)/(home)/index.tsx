// 와이어프레임 1 홈 (작품 선택) + 1-1 번호 입력 (디자인 "저시력 미술관 앱"에서 홈에 합쳐짐)
/**
 * 현재 미술관 카드 → 작품 번호 입력(이 화면의 주 동작, 가장 크게) → 작품 목록.
 * 번호를 입력하면 목록이 바로 걸러진다. 미술관을 고르지 않았으면 입력칸 자리에
 * "미술관을 먼저 골라 주세요" 버튼을 두고, 누르면 1-0으로 간다 (포커스만으로는 화면을 바꾸지 않는다).
 * 목록은 불러오는 중 · 오류 · 빈 상태 · 결과 네 가지를 모두 그린다.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
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
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
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

  const onSubmitNumber = () => {
    const exact = works.find((a) => Number(a.number) === Number(num));
    const target = exact ?? (works.length === 1 ? works[0] : undefined);
    if (target) openArtwork(target.id);
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

        {/* A visible label: the placeholder disappears as soon as a number is typed. */}
        <Text
          nativeID="number-label"
          style={[styles.inputLabel, { color: palette.text }]}
          onPress={() => inputRef.current?.focus()}>
          작품 번호
        </Text>
        <View style={styles.findRow}>
          {/* A transparent ring that only takes a color on focus, so the field never changes size. */}
          <View style={[styles.ring, { borderColor: inputFocused ? palette.text : 'transparent' }]}>
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
              <TextInput
                ref={inputRef}
                accessibilityLabelledBy="number-label"
                accessibilityLabel="작품 번호 입력"
                accessibilityHint="작품 옆에 적힌 번호를 입력하면 목록이 걸러져요"
                placeholder="작품 옆 명패의 번호"
                placeholderTextColor={palette.textSecondary}
                keyboardType="number-pad"
                returnKeyType="search"
                maxLength={3}
                value={num}
                onChangeText={(v) => setNum(v.replace(/\D/g, ''))}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onSubmitEditing={onSubmitNumber}
                style={[styles.field, styles.fieldText, inputSurface(palette), { color: palette.text }]}
              />
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

        <View style={styles.listHeader}>
          <View style={styles.listTitleRow}>
            <Text accessibilityRole="header" style={[styles.listTitle, { color: palette.text }]}>
              작품 목록
            </Text>
            {!!museum && artworks && (
              <Text style={[styles.count, { color: palette.textSecondary }]}>{works.length}점</Text>
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
                { backgroundColor: palette.fill, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.browseText, { color: palette.text }]}>크게 넘겨보기</Text>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={18}
                weight="bold"
                tintColor={palette.text}
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
            <PillButton label="미술관 선택하기" palette={palette} onPress={() => openPicker('list')} />
          </View>
        ) : !artworks ? (
          <View accessible accessibilityLabel="작품 목록을 불러오는 중" style={styles.skeletonList}>
            {Array.from({ length: SkeletonRows }, (_, i) => (
              <View key={i} style={[styles.skeletonRow, { backgroundColor: palette.fill }]} />
            ))}
          </View>
        ) : works.length === 0 ? (
          <Text style={[styles.none, { color: palette.textSecondary }]}>
            {num ? `${num}번 작품이 없어요` : '이 미술관에 등록된 작품이 없어요'}
          </Text>
        ) : (
          works.map((a) => (
            <ArtworkCard key={a.id} artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function inputSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.border };
}

function PillButton({ label, palette, onPress }: { label: string; palette: Palette; onPress: () => void }) {
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  skeletonCard: {
    height: 96,
    borderRadius: 24,
  },
  inputLabel: {
    marginBottom: -Spacing.two,
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
  fieldText: {
    fontSize: FontSize.heading,
    fontWeight: 800,
    textAlign: 'center',
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
    marginTop: Spacing.three,
    marginHorizontal: Spacing.one,
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  browse: {
    minHeight: MinTouchTarget,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: MinTouchTarget / 2,
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
    minHeight: MinTouchTarget,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: MinTouchTarget / 2,
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
