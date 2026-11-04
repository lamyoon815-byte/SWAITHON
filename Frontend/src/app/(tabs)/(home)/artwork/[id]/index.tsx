// 와이어프레임 2 작품 감상 (디자인 "저시력 미술관 앱" 기준 1차 버전)
/**
 * 작품 이미지 · 미술관과 번호 · 제목 · 작가 · 음성 해설.
 * TODO(B): 이미지에 correction-canvas(Skia 보정, 원본 전환, 강도, 핀치 줌)를 붙이고,
 * 해설은 3 해설 재생 화면(`narration.tsx`, segments 한 문장씩)으로 옮긴다 (README 6.2).
 */

import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { FontSize, getPalette } from '@/constants/a11y';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { ApiError, getArtwork, getMuseums } from '@/lib/api';

export default function ArtworkScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const { data: museums } = useResource('museums', getMuseums);
  const [speaking, setSpeaking] = useState(false);

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
    Speech.speak([...facts, ...interpretations].join(' '), {
      language: 'ko-KR',
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
            <View style={[styles.image, { backgroundColor: Colors[scheme].backgroundSelected }]}>
              {artwork.image_url ? (
                <Image
                  source={{ uri: artwork.image_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  accessibilityLabel={`${artwork.title} 이미지`}
                />
              ) : (
                <Text style={[styles.imageNote, { color: palette.textSecondary }]}>
                  작품 이미지 준비 중
                </Text>
              )}
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
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageNote: {
    fontSize: 16,
    fontWeight: 600,
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
