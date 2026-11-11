// 작품 찾기 (와이어프레임 1-1 번호 입력을 네이버 검색 화면 방식으로). 홈 검색창을 누르면 열린다
/**
 * 탭 바 없는 전체 화면. 위에서부터 길고 둥근 입력창(← · 번호 · ✕ · 🔍) → 현재 미술관 · 변경 →
 * 번호를 쳤으면 맞는 작품, 안 쳤으면 최근 본 작품(✕로 하나씩, 전체삭제) → 키보드 바로 위 도구 줄
 * (취소 · 음성 · QR · 카메라). 번호가 정확히 맞거나 하나만 남으면 🔍·키보드 "검색"으로 바로 간다.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtworkCard } from '@/components/common/artwork-card';
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
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Artwork } from '@/types/artwork';

const BarHeight = 64;

/** "1"은 01, 11, 12…와 맞고, "12"는 12와 맞는다. */
function matchesNumber(artwork: Artwork, query: string) {
  return artwork.number.includes(query) || String(Number(artwork.number)).startsWith(query);
}

/** "2026-11-07T…" → "11.07." (네이버 최근 검색어 날짜 형식) */
function shortDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.`;
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

  const museum = museums?.find((m) => m.id === museumId);
  const results = num ? (artworks ?? []).filter((a) => matchesNumber(a, num)) : [];

  const openArtwork = (id: string) => router.push({ pathname: '/artwork/[id]', params: { id } });
  const openCapture = (mode: 'qr' | 'artwork') =>
    router.push({ pathname: '/capture', params: { mode } });
  const pickMuseum = () => router.push({ pathname: '/museum', params: { next: 'number' } });

  const submit = () => {
    if (!num) {
      showToast('작품 옆 명패의 번호를 먼저 입력해 주세요', 'warning');
      return;
    }
    const exact = results.find((a) => Number(a.number) === Number(num));
    const target = exact ?? (results.length === 1 ? results[0] : undefined);
    if (target) openArtwork(target.id);
    else if (results.length === 0)
      showToast(`${num}번 작품이 없어요. 번호를 확인해 주세요`, 'warning');
    else
      showToast(`${num}(으)로 시작하는 작품이 여러 개예요. 번호를 끝까지 입력해 주세요`, 'warning');
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Search bar: back · number · clear · search, all in one long round field. */}
        <View style={styles.top}>
          <View
            style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.accent }]}>
            <IconButton
              ios="arrow.left"
              android="arrow_back"
              label="뒤로"
              palette={palette}
              onPress={() => router.back()}
            />
            <TextInput
              accessibilityLabel="작품 옆 명패 번호"
              accessibilityHint="번호를 입력하면 맞는 작품이 아래에 보여요"
              autoFocus={!!museumId}
              editable={!!museumId}
              placeholder="작품 옆 명패 번호"
              placeholderTextColor={palette.textSecondary}
              keyboardType="number-pad"
              returnKeyType="search"
              maxLength={3}
              value={num}
              onChangeText={(v) => setNum(v.replace(/\D/g, ''))}
              onSubmitEditing={submit}
              style={[styles.input, { color: palette.text }]}
            />
            {!!num && (
              <IconButton
                ios="xmark.circle.fill"
                android="cancel"
                label="번호 지우기"
                palette={palette}
                muted
                onPress={() => setNum('')}
              />
            )}
            <IconButton
              ios="magnifyingglass"
              android="search"
              label="이 번호로 찾기"
              palette={palette}
              onPress={submit}
            />
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
                  {museum ? museum.name : '미술관을 먼저 골라 주세요'}
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
                      accessibilityLabel={`${a.number}번, ${a.title}, ${a.artist}, ${shortDate(a.viewed_at)}에 봄`}
                      onPress={() => openArtwork(a.id)}
                      pressedScale={0.98}
                      background={palette.surface}
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

        {/* Toolbar right above the keyboard (Naver): cancel on the left, other ways to find on the right. */}
        <View style={styles.toolbar}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="취소"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.cancel,
              toolbarSurface(palette),
              pressed && pressedSurface(palette),
            ]}>
            {({ pressed }) => (
              <Text
                style={[
                  styles.cancelText,
                  { color: pressed ? palette.highlightText : palette.text },
                ]}>
                취소
              </Text>
            )}
          </PressableScale>
          <View style={[styles.tools, toolbarSurface(palette)]}>
            <IconButton
              ios="mic.fill"
              android="mic"
              label="음성으로 찾기"
              palette={palette}
              onPress={() => showToast('음성으로 찾기는 준비 중이에요')}
            />
            <IconButton
              ios="qrcode.viewfinder"
              android="qr_code_scanner"
              label="QR로 찾기"
              palette={palette}
              onPress={() => openCapture('qr')}
            />
            <IconButton
              ios="camera.fill"
              android="photo_camera"
              label="카메라로 찾기"
              palette={palette}
              onPress={() => openCapture('artwork')}
            />
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
  onPress: () => void;
};

/** 56×56 아이콘 버튼. 아이콘이 작아도 누르는 곳은 최소 터치 영역을 지킨다. */
function IconButton({ ios, android, label, palette, muted, onPress }: IconButtonProps) {
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
          tintColor={pressed ? palette.highlightText : muted ? palette.textSecondary : palette.text}
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
