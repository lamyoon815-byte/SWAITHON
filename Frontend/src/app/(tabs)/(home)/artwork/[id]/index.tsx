// 와이어프레임 2 작품 감상 (디자인 "저시력 미술관 앱" 기준 1차 버전)
/**
 * 작품 이미지(보정 캔버스) · 보정본/원본 전환 · 미술관과 번호 · 제목 · 작가 · 음성 해설.
 * TODO(B): 보정 강도 슬라이더, 영역 터치(regions, P1).
 * 해설은 3 해설 재생 화면(`narration.tsx`, segments 한 문장씩)으로 옮긴다 (README 6.2).
 */

import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { FontSize, getPalette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { ApiError, getArtwork, getMuseums } from '@/lib/api';
import { speakKorean } from '@/lib/speech';
import { DEFAULT_PROFILE } from '@/types/profile';

// TODO(A): 로그인 후 받은 시각 프로필(use-profile)로 바꾼다. 지금은 BE 기본값이라 보정본과 원본이 같다.
const profile = DEFAULT_PROFILE;

export default function ArtworkScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const { data: museums } = useResource('museums', getMuseums);
  const [speaking, setSpeaking] = useState(false);
  const [original, setOriginal] = useState(false);

  // Stop reading when the user leaves this screen (tab switch or back).
  useFocusEffect(
    useCallback(
      () => () => {
        Speech.stop();
        setSpeaking(false);
      },
      [],
    ),
  );

  const museum = museums?.find((m) => m.id === artwork?.museum_id);
  // Mustard text is too faint on the light background, so light mode uses the body text color.
  const metaColor = scheme === 'dark' ? palette.highlight : palette.text;

  const toggleSpeech = () => {
    if (!artwork?.description) return;
    if (speaking) {
      Speech.stop();
      setSpeaking(false);
      return;
    }
    const { facts, interpretations } = artwork.description;
    setSpeaking(true);
    void speakKorean([...facts, ...interpretations].join(' '), {
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <BackButton label="작품 목록으로" palette={palette} scheme={scheme} />

        {error ? (
          <Text style={[styles.message, { color: palette.text }]}>
            {error instanceof ApiError && error.status === 404
              ? '작품을 찾지 못했어요'
              : '작품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요'}
          </Text>
        ) : !artwork ? null : (
          <>
            <CorrectionCanvas
              source={artwork.image_url}
              accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
              correction={profile}
              original={original}
              zoomable
              palette={palette}
              style={styles.image}
            />

            <View accessibilityRole="radiogroup" accessibilityLabel="보기 방식" style={styles.toggle}>
              <BigButton
                label={original ? '보정본' : '✓ 보정본'}
                onPress={() => setOriginal(false)}
                palette={palette}
                selected={!original}
              />
              <BigButton
                label={original ? '✓ 원본 보기' : '원본 보기'}
                onPress={() => setOriginal(true)}
                palette={palette}
                selected={original}
              />
            </View>

            <View style={styles.texts}>
              <Text style={[styles.meta, { color: metaColor }]}>
                {[museum?.name, `No. ${artwork.number}`].filter(Boolean).join(' · ')}
              </Text>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
                {artwork.title}
              </Text>
              <Text style={[styles.artist, { color: palette.textSecondary }]}>
                {[artwork.artist, artwork.year].filter(Boolean).join(' · ')}
              </Text>
            </View>

            {artwork.description ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: speaking }}
                onPress={toggleSpeech}
                style={({ pressed }) => [
                  styles.audio,
                  { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.audioText, { color: palette.accentText }]}>
                  {speaking ? '■ 음성 해설 멈추기' : '▶ 음성 해설 듣기'}
                </Text>
              </Pressable>
            ) : (
              // README 6.1: description이 null이면 해설 버튼 대신 안내.
              <Text style={[styles.message, { color: palette.textSecondary }]}>
                아직 해설이 준비되지 않았어요
              </Text>
            )}
          </>
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  image: {
    height: 320,
    borderRadius: 32,
  },
  toggle: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  texts: {
    gap: 6,
    paddingHorizontal: Spacing.one,
  },
  meta: {
    fontSize: 16,
    fontWeight: 700,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 800,
    lineHeight: 34,
  },
  artist: {
    fontSize: FontSize.label,
    fontWeight: 600,
  },
  audio: {
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  message: {
    paddingVertical: Spacing.three,
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
});
