// 작품 찾기 (와이어프레임 1-1 번호 입력을 네이버 검색 화면 방식으로). 홈 검색창을 누르면 열린다
/**
 * 탭 바 없는 전체 화면. 위에서부터 길고 둥근 입력창(← · 번호 · ✕ · 🔍) → 현재 미술관 · 변경 →
 * 번호를 쳤으면 맞는 작품, 안 쳤으면 최근 본 작품(✕로 하나씩, 전체삭제) → 키보드 바로 위 도구 줄
 * (취소 · 음성 · QR · 카메라). 번호가 정확히 맞거나 하나만 남으면 🔍·키보드 "검색"으로 바로 간다.
 * 음성: 🎤를 누르고 작품 제목·작가·번호를 말하면(6초 뒤 자동 멈춤) /transcribe로 글자를 받아 지금 미술관 작품에서 찾는다.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtworkCard } from '@/components/common/artwork-card';
import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { PressableScale } from '@/components/common/pressable-scale';
import {
  ButtonHeight,
  ButtonRadius,
  FontSize,
  MinTouchTarget,
  getPalette,
  type Palette,
} from '@/constants/a11y';
import { Shadow, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRecent } from '@/hooks/use-recent';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useVoiceAnswer } from '@/hooks/use-voice-answer';
import { ApiError, getArtworkByNumber, getMuseumArtworks, getMuseums } from '@/lib/api';
import { findArtworksBySpeech } from '@/lib/voice-search';
import type { Artwork } from '@/types/artwork';

const BarHeight = 64;

/** "1"은 01, 11, 12…와 맞고, "12"는 12와 맞는다. */
function matchesNumber(artwork: Artwork, query: string) {
  return artwork.number.includes(query) || String(Number(artwork.number)).startsWith(query);
}

/** "2026-11-07T…" → "11.07." (네이버 최근 검색어 날짜 형식) */
function shortDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 스크린리더용: "11월 11일" */
function spokenDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function SearchScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const { settings, loaded } = useSettings();
  const museumId = settings.recent_museum_id;
  const { data: museums } = useResource('museums', getMuseums);
  const { data: artworks } = useResource(museumId, () => getMuseumArtworks(museumId!));
  const recent = useRecent();
  const [num, setNum] = useState('');
  // 음성으로 찾은 작품이 여러 개일 때 보여 줄 목록
  const [voiceFound, setVoiceFound] = useState<{ text: string; items: Artwork[] } | null>(null);
  const voice = useVoiceAnswer('artwork');

  const museum = museums?.find((m) => m.id === museumId);
  const results = num ? (artworks ?? []).filter((a) => matchesNumber(a, num)) : [];

  const openArtwork = (id: string) => router.push({ pathname: '/artwork/[id]', params: { id } });
  const openCapture = (mode: 'qr' | 'artwork') =>
    router.push({ pathname: '/capture', params: { mode } });
  const pickMuseum = () => router.push({ pathname: '/museum', params: { next: 'number' } });

  const submitNumber = async (value: string) => {
    const matches = value ? (artworks ?? []).filter((a) => matchesNumber(a, value)) : [];
    const exact = matches.find((a) => Number(a.number) === Number(value));
    const target = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (target) openArtwork(target.id);
    else if (museumId) {
      // Only the first 100 artworks are loaded here; ask the server for the exact number.
      try {
        const found = await getArtworkByNumber(museumId, value.padStart(2, '0'));
        openArtwork(found.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && matches.length > 1)
          showToast(`${value}(으)로 시작하는 작품이 여러 개예요`, 'warning');
        else if (error instanceof ApiError && error.status === 404)
          showToast(`${value}번 작품이 없어요. 번호를 확인해 주세요`, 'warning');
        else showToast('작품을 찾지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
      }
    } else if (matches.length === 0)
      showToast(`${value}번 작품이 없어요. 번호를 확인해 주세요`, 'warning');
    else
      showToast(`${value}(으)로 시작하는 작품이 여러 개예요`, 'warning');
  };

  const submit = () => {
    if (!num) {
      showToast('작품 옆 명패의 번호를 먼저 입력해 주세요', 'warning');
      return;
    }
    void submitNumber(num);
  };

  const searchByVoice = () => {
    if (!museumId) {
      showToast('미술관을 먼저 골라 주세요', 'warning');
      return;
    }
    if (!artworks) {
      showToast('작품을 불러오는 중이에요. 잠시 후 다시 눌러 주세요', 'warning');
      return;
    }
    if (voice.state === 'thinking') return;
    if (voice.state === 'idle')
      showToast('작품 제목이나 번호를 말해 주세요');
    voice.toggle({
      onText: (text) => {
        const found = findArtworksBySpeech(text, artworks);
        if (found.kind === 'number') {
          setVoiceFound(null);
          setNum(found.number.slice(0, 5));
          void submitNumber(found.number);
        } else if (found.kind === 'artworks' && found.items.length === 1) {
          setVoiceFound(null);
          showToast('작품을 찾았어요', 'success');
          openArtwork(found.items[0].id);
        } else if (found.kind === 'artworks') {
          setNum('');
          setVoiceFound({ text, items: found.items });
        } else {
          setVoiceFound(null);
          showToast(text ? `"${text}"에 맞는 작품을 찾지 못했어요. 다시 말하거나 번호로 찾아 주세요` : '잘 들리지 않았어요. 다시 말해 주세요', 'warning');
        }
      },
      onError: (message) => showToast(message, 'warning'),
    });
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Search bar: back · number · clear · search, all in one long round field. */}
        <View style={styles.top}>
          <View
            accessibilityLiveRegion="polite"
            style={[styles.bar, voice.state === 'recording'
              ? { backgroundColor: palette.highlight, borderColor: palette.highlight }
              : { backgroundColor: palette.surface, borderColor: palette.accent }]}
          >
            <IconButton
              ios="arrow.left"
              android="arrow_back"
              label="뒤로"
              palette={palette}
              inverted={voice.state === 'recording'}
              onPress={() => router.back()}
            />
            <TextInput
              accessibilityLabel="작품 옆 명패 번호"
              accessibilityHint="번호를 입력하면 맞는 작품이 아래에 보여요"
              autoFocus={!!museumId}
              editable={!!museumId}
              placeholder={voice.state === 'recording' ? '듣고 있어요…' : '작품 옆 명패 번호'}
              placeholderTextColor={voice.state === 'recording' ? palette.highlightText : palette.textSecondary}
              // 찾기는 키보드 위 큰 '찾기' 버튼 하나로만 한다. iOS 숫자 키패드엔 원래 오른쪽 아래 키가 없고,
              // 안드로이드는 키 자체를 숨길 수 없어 이름 없는 키(none)로 두고 눌러도 아무 일도 하지 않게 한다.
              keyboardType="number-pad"
              returnKeyType={Platform.OS === 'android' ? 'none' : 'default'}
              submitBehavior="submit"
              maxLength={5}
              value={num}
              onChangeText={(v) => {
                setVoiceFound(null);
                setNum(v.replace(/\D/g, ''));
              }}
              style={[styles.input, { color: voice.state === 'recording' ? palette.highlightText : palette.text }]}
            />
            {!!num && (
              <IconButton
                ios="xmark.circle.fill"
                android="cancel"
                label="번호 지우기"
                palette={palette}
                inverted={voice.state === 'recording'}
                muted
                onPress={() => setNum('')}
              />
            )}
          </View>

          {/* Current museum as its own small card, so it reads as a section and not a caption. */}
          {loaded && (
            <View style={[styles.museumCard, toolbarSurface(palette)]}>
              <View style={[styles.museumIcon, { backgroundColor: palette.fill }]}>
                <SymbolView
                  name={{
                    ios: 'building.columns',
                    android: 'account_balance',
                    web: 'account_balance',
                  }}
                  size={20}
                  weight="medium"
                  tintColor={palette.text}
                />
              </View>
              <View style={styles.museumTexts}>
                <Text style={[styles.museumCaption, { color: palette.textSecondary }]}>
                  {museum ? '여기서 찾아요' : '현재 미술관'}
                </Text>
                <Text style={[styles.museumName, { color: palette.text }]}>
                  {museum ? museum.name : museumId ? '미술관 불러오는 중' : '미술관을 먼저 골라 주세요'}
                </Text>
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={museum ? `미술관 변경, 지금 ${museum.name}` : '미술관 선택하기'}
                onPress={pickMuseum}
                style={({ pressed }) => [
                  styles.smallButton,
                  museum ? { backgroundColor: palette.fill } : { backgroundColor: palette.accent },
                  pressed && pressedSurface(palette),
                ]}>
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.smallButtonText,
                      { color: museum ? palette.text : palette.accentText },
                      pressed && { color: palette.highlightText },
                    ]}>
                    {museum ? '변경' : '선택'}
                  </Text>
                )}
              </PressableScale>
            </View>
          )}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {num ? (
            results.length === 0 ? (
              <Text
                accessibilityRole="alert"
                style={[styles.none, { color: palette.textSecondary }]}>
                {artworks ? `${num}번 작품이 없어요` : '작품을 불러오는 중이에요'}
              </Text>
            ) : (
              <>
                <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
                  {results.length}점 찾았어요
                </Text>
                {results.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                    <ArtworkCard artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
                  </View>
                ))}
              </>
            )
          ) : voiceFound ? (
            <>
              <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
                {`"${voiceFound.text}"(으)로 ${voiceFound.items.length}점 찾았어요`}
              </Text>
              {voiceFound.items.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                  <ArtworkCard artwork={a} palette={palette} onPress={() => openArtwork(a.id)} />
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={styles.recentHeader}>
                <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
                  최근 본 작품
                </Text>
                {recent.items.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="최근 본 작품 전체 삭제"
                    onPress={() => {
                      void recent.clearRecent();
                      showToast('최근 본 작품을 모두 지웠어요', 'success');
                    }}
                    style={({ pressed }) => [
                      styles.textButton,
                      pressed && pressedSurface(palette),
                    ]}>
                    {({ pressed }) => (
                      <Text
                        style={[
                          styles.textButtonLabel,
                          { color: pressed ? palette.highlightText : palette.textSecondary },
                        ]}>
                        전체삭제
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
              {recent.loaded && recent.items.length === 0 && (
                <Text style={[styles.none, { color: palette.textSecondary }]}>
                  아직 본 작품이 없어요
                </Text>
              )}
              {recent.items.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: palette.fill }]} />}
                  <View style={styles.recentRow}>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`${a.number}번, ${a.title}, ${a.artist}, ${spokenDate(a.viewed_at)}에 봄`}
                      onPress={() => openArtwork(a.id)}
                      pressedScale={0.98}
                      background={`${palette.background}00`}
                      pressedBackground={palette.fill}
                      style={styles.recentMain}>
                      <View style={[styles.thumb, { backgroundColor: palette.fill }]}>
                        {a.image_url ? (
                          <Image
                            source={{ uri: a.image_url }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                          />
                        ) : (
                          <Text style={[styles.thumbNumber, { color: palette.text }]}>
                            {a.number}
                          </Text>
                        )}
                      </View>
                      <View style={styles.recentTexts}>
                        <Text
                          numberOfLines={1}
                          style={[styles.recentTitle, { color: palette.text }]}>
                          {a.title}
                        </Text>
                        <Text style={[styles.recentSub, { color: palette.textSecondary }]}>
                          {[a.number && `No. ${a.number}`, a.artist].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Text style={[styles.date, { color: palette.textSecondary }]}>
                        {shortDate(a.viewed_at)}
                      </Text>
                    </PressableScale>
                    <IconButton
                      ios="xmark"
                      android="close"
                      label={`${a.title} 기록 지우기`}
                      palette={palette}
                      muted
                      onPress={() => void recent.removeRecent(a.id)}
                    />
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>

        {/* 키보드 바로 위 (토스식): 카메라로 찾기 + 큰 '이 번호로 찾기'. iOS 숫자 키패드에는 검색 키가 없어 이 버튼이 꼭 필요하다. */}
        <View style={styles.toolbar}>
          <View style={[styles.tools, toolbarSurface(palette)]}>
            <IconButton
              ios={voice.state === 'recording' ? 'stop.fill' : 'mic.fill'}
              android={voice.state === 'recording' ? 'stop' : 'mic'}
              label={voice.state === 'recording' ? '말하기 끝내기' : voice.state === 'thinking' ? '알아듣는 중' : '음성으로 찾기'}
              palette={palette}
              onPress={searchByVoice}
            />
            <IconButton
              ios="camera.fill"
              android="photo_camera"
              label="카메라로 찾기"
              palette={palette}
              onPress={() => openCapture('artwork')}
            />
          </View>
          <View style={styles.findButton}>
            <BigButton label={num ? `${num}번 찾기` : '이 번호로 찾기'} accessibilityLabel={num ? `${num}번 작품 찾기` : '이 번호로 찾기'}
              accessibilityHint="입력한 번호의 작품을 열어요" palette={palette} disabled={!num || !museumId} onPress={submit} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * While a button is held it turns mustard (point color) with charcoal content, so you can see
 * exactly which one you are pressing. Shape stays the same; only the fill changes.
 */
function pressedSurface(palette: Palette) {
  return { backgroundColor: palette.highlight, borderColor: palette.highlight };
}

function toolbarSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.outline };
}

type IconButtonProps = {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  palette: Palette;
  muted?: boolean;
  inverted?: boolean;
  onPress: () => void;
};

/** 56×56 아이콘 버튼. 아이콘이 작아도 누르는 곳은 최소 터치 영역을 지킨다. */
function IconButton({ ios, android, label, palette, muted, inverted, onPress }: IconButtonProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && pressedSurface(palette)]}>
      {({ pressed }) => (
        <SymbolView
          name={{ ios, android, web: android }}
          size={22}
          weight="medium"
          tintColor={pressed || inverted ? palette.highlightText : muted ? palette.textSecondary : palette.text}
        />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  top: {
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  // Long and fully round, like Naver's search field.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BarHeight,
    paddingHorizontal: 4,
    borderWidth: 2,
    borderRadius: BarHeight / 2,
  },
  input: {
    flex: 1,
    minHeight: BarHeight - 8,
    paddingVertical: 8,
    fontSize: FontSize.body,
    fontWeight: 700,
  },
  iconButton: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  museumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderWidth: 1.5,
    borderRadius: 20,
  },
  museumIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  museumTexts: {
    flex: 1,
    gap: 2,
  },
  museumCaption: {
    fontSize: 15,
    fontWeight: 600,
  },
  museumName: {
    fontSize: FontSize.label,
    fontWeight: 800,
    lineHeight: 25,
  },
  smallButton: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: {
    fontSize: 16,
    fontWeight: 800,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    gap: Spacing.one,
  },
  heading: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  textButton: {
    minHeight: 44,
    borderRadius: ButtonRadius,
    paddingHorizontal: Spacing.two,
    justifyContent: 'center',
  },
  textButtonLabel: {
    fontSize: 16,
    fontWeight: 700,
  },
  // 위쪽은 목록의 gap(4)이 띄워 주니 아래만 같은 만큼 띄워, 누른 행의 회색 상자가 구분선 사이 가운데에 오게 한다.
  divider: {
    height: 1.5,
    marginBottom: Spacing.one,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingVertical: Spacing.two,
    // 누를 때 생기는 회색 상자가 썸네일에 딱 붙지 않게 왼쪽으로 조금 넓힌다.
    marginLeft: -Spacing.two,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.one,
    borderRadius: 16,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbNumber: {
    fontSize: 16,
    fontWeight: 800,
  },
  recentTexts: {
    flex: 1,
    gap: 2,
  },
  recentTitle: {
    fontSize: FontSize.label,
    fontWeight: 700,
  },
  recentSub: {
    fontSize: 16,
    fontWeight: 500,
  },
  date: {
    fontSize: 16,
    fontWeight: 600,
    fontVariant: ['tabular-nums'],
  },
  none: {
    paddingVertical: Spacing.four,
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
  findButton: { flex: 1, flexDirection: 'row' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  cancel: {
    minHeight: ButtonHeight,
    paddingHorizontal: 22,
    borderWidth: 1.5,
    borderRadius: ButtonHeight / 2,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Shadow.floating,
  },
  cancelText: {
    fontSize: 17,
    fontWeight: 700,
  },
  tools: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderRadius: ButtonHeight / 2 + 4,
    boxShadow: Shadow.floating,
  },
});
