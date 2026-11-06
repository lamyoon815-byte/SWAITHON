// 와이어프레임 1 홈 (작품 선택) + 1-1 번호 입력 (디자인 "저시력 미술관 앱"에서 홈에 합쳐짐)
/**
 * 현재 미술관 카드 · 작품 번호 입력 · 음성 찾기 버튼 · 작품 목록.
 * 번호를 입력하면 목록이 바로 걸러진다. 미술관을 고르지 않았으면 번호 입력·목록은 1-0으로 먼저 보낸다.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtworkCard } from '@/components/common/artwork-card';
import { showToast } from '@/components/common/toast';
import { MuseumCard } from '@/components/home/museum-card';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Artwork } from '@/types/artwork';
import type { MuseumNext } from '@/types/museum';

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
  const { data: museums } = useResource('museums', getMuseums);
  const { data: artworks } = useResource(museumId, () => getMuseumArtworks(museumId!));
  const inputRef = useRef<TextInputInstance>(null);
  const [num, setNum] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const museum = museums?.find((m) => m.id === museumId);
  const works = (artworks ?? []).filter((a) => !num || matchesNumber(a, num));

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
        {loaded && <MuseumCard museum={museum} palette={palette} onChange={() => openPicker()} />}

        {/* A visible label: the placeholder disappears as soon as a number is typed. */}
        <Text
          nativeID="number-label"
          style={[styles.inputLabel, { color: palette.text }]}
          onPress={() => inputRef.current?.focus()}>
          작품 번호
        </Text>
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
          onFocus={() => {
            if (!museumId) openPicker('number');
            else setInputFocused(true);
          }}
          onBlur={() => setInputFocused(false)}
          onSubmitEditing={onSubmitNumber}
          style={[
            styles.input,
            {
              backgroundColor: palette.surface,
              color: palette.text,
              borderColor: inputFocused ? palette.accent : palette.border,
              borderWidth: inputFocused ? 3 : 2,
            },
          ]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="음성으로 작품 찾기"
          // README 3장: 음성 인식은 Expo Go에서 안 돼 기능은 P2. 버튼만 둔다.
          onPress={() => showToast('음성으로 찾기는 준비 중이에요')}
          style={({ pressed }) => [
            styles.voice,
            { backgroundColor: Colors[scheme].backgroundSelected, opacity: pressed ? 0.8 : 1 },
          ]}>
          <SymbolView
            name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
            size={22}
            tintColor={palette.text}
          />
          <Text style={[styles.voiceText, { color: palette.text }]}>음성으로 작품 찾기</Text>
        </Pressable>

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
                { backgroundColor: Colors[scheme].backgroundSelected, opacity: pressed ? 0.8 : 1 },
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

        {loaded && !museumId && (
          <View style={[styles.emptyBox, { backgroundColor: palette.surface }]}>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              미술관을 고르면 작품 목록이 보여요
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => openPicker('list')}
              style={({ pressed }) => [
                styles.pickButton,
                { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.pickText, { color: palette.accentText }]}>미술관 선택하기</Text>
            </Pressable>
          </View>
        )}

        {works.map((a) => (
          <ArtworkCard
            key={a.id}
            artwork={a}
            palette={palette}
            scheme={scheme}
            onPress={() => openArtwork(a.id)}
          />
        ))}

        {!!museumId && artworks && works.length === 0 && (
          <Text style={[styles.none, { color: palette.textSecondary }]}>찾는 작품이 없어요</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  inputLabel: {
    marginTop: Spacing.one,
    marginHorizontal: Spacing.one,
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  // Heights are minimums everywhere below: with the largest system text size a fixed height clips
  // the words, and low-vision users are the ones who turn text size all the way up.
  input: {
    minHeight: 60,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: FontSize.body,
    fontWeight: 700,
    textAlign: 'center',
  },
  voice: {
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  voiceText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: 14,
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
    borderRadius: MinTouchTarget / 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
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
  emptyBox: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  emptyText: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
  pickButton: {
    minHeight: MinTouchTarget,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickText: {
    fontSize: 17,
    fontWeight: 800,
  },
  none: {
    padding: Spacing.four,
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
});
