// 와이어프레임 3 해설 재생. 작품 상세의 "음성 해설 듣기"에서 들어온다
/**
 * 작품을 크게 보면서 듣는 화면. 위에서부터 작품(보정 적용, 화면 대부분) → 지금 읽는 문장(자막 카드) →
 * 아래 고정 재생판(진행 · 반복 · 이전 · 재생/멈춤 · 다음 · 속도).
 * 전체 문장과 듣는 범위(전체 · 사실 · 해석)는 오른쪽 위 "문장 목록" 시트에서 고른다. 문장을 누르면 거기서부터 읽는다.
 * 사실/해석은 색이 아니라 "사실"·"해석" 글자 표시로 구분한다.
 * 검수 해설이 없으면(409) 들어오자마자 AI 해설을 만들어 바로 들을 수 있게 한다(서버가 결과를 저장해 다시 만들지 않는다).
 * 작품·자막 부분은 스크롤되고, 재생판은 아래에 고정된다.
 * 배경 음악이 켜져 있으면(기본 켜짐, 마이페이지와 같은 설정) 해설 전체의 분위기(10가지)에 맞는 음악을 해설 뒤에 작게 깐다.
 */

import { useLocalSearchParams } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, Image as NativeImage, Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from '@/components/common/text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtworkZoomView } from '@/components/artwork/zoom-view';
import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { MascotLoading } from '@/components/common/mascot-loading';
import { SegmentedControl } from '@/components/common/segmented-control';
import { PressableScale } from '@/components/common/pressable-scale';
import { RegionOverlay } from '@/components/narration/region-overlay';
import { SeekBar } from '@/components/narration/seek-bar';
import { SpeedSheet, formatRate } from '@/components/narration/speed-sheet';
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
import { useNarrationPlayer } from '@/hooks/use-narration-player';
import { useBackgroundMusic } from '@/hooks/use-background-music';
import { useSettings } from '@/hooks/use-settings';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { ApiError, generateNarration, getArtwork, getNarration, getNarrationMood } from '@/lib/api';
import type { NarrationLength, NarrationMode } from '@/types/narration';
import { DEFAULT_PROFILE } from '@/types/profile';
import { correctionStrength, viewingFromProfile } from '@/lib/calibration';
import { useCorrectedArtwork } from '@/hooks/use-corrected-artwork';

const START_RATE = DEFAULT_PROFILE.speech_rate;

const LENGTHS: { value: NarrationLength; label: string; hint: string }[] = [
  { value: 'brief', label: '간결하게', hint: '약 1분, 그림 위주' },
  { value: 'detailed', label: '상세하게', hint: '약 3분, 화가와 시대 이야기까지' },
];

const MODES: { mode: NarrationMode; label: string }[] = [
  { mode: 'both', label: '전체' },
  { mode: 'facts', label: '사실' },
  { mode: 'interpretations', label: '해석' },
];

export default function NarrationScreen() {
  const { profile, loaded: profileLoaded } = useProfile();
  const [selectedMode, setMode] = useState<NarrationMode | null>(null);
  const mode = selectedMode ?? profile.narration_mode;
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [playerBarHeight, setPlayerBarHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  // 상세 화면의 임시 적용 비율 대신 계정에 저장한 보정값을 사용한다.
  const strength = correctionStrength(profile.strength);
  const { data: artwork } = useResource(id ?? null, () => getArtwork(id!));
  // 해설을 듣는 동안은 항상 사용자 설정의 보정본을 표시한다.
  const corrected = useCorrectedArtwork(artwork?.id, artwork?.image_url, viewingFromProfile(profile), false, strength);
  const narrationRes = useResource(id && profileLoaded ? `narration:${id}:${mode}` : null, () => getNarration(id!, mode));
  const [rate, setRate] = useState(START_RATE);
  const [repeat, setRepeat] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [length, setLength] = useState<NarrationLength>('brief');

  // 검수 해설이 없으면(409) 들어오자마자 AI 해설을 만든다. 같은 작품은 앱·서버 모두 저장해 두어 다시 만들지 않는다.
  const noReviewed = narrationRes.error instanceof ApiError && narrationRes.error.status === 409;
  const aiRes = useResource(noReviewed && id ? `ai-narration:${id}:${length}` : null, () => generateNarration(id!, length));
  const ai = aiRes.data ?? null;
  const aiError = aiRes.error ? (aiRes.error instanceof ApiError && aiRes.error.status === 429
    ? '해설 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.'
    : aiRes.error instanceof ApiError && aiRes.error.status === 503
      ? '해설을 지금 준비할 수 없어요. 잠시 후 다시 시도해 주세요.'
      : '해설을 준비하지 못했어요. 다시 시도해 주세요.') : null;
  const all = ai?.segments ?? narrationRes.data?.segments ?? [];
  const segments = all.filter(
    (s) => mode === 'both' || (mode === 'facts' ? s.type === 'fact' : s.type === 'interpretation'),
  );
  const player = useNarrationPlayer(
    segments.map((s) => s.text),
    rate,
    repeat,
  );

  // 배경 음악: 해설 전체 글로 분위기를 한 번 정한다(듣는 범위를 바꿔도 그대로). 꺼져 있으면 묻지 않는다.
  const { settings, loaded: settingsLoaded, updateSettings } = useSettings();
  const musicOn = settingsLoaded && settings.background_music;
  const moodRes = useResource(musicOn && id && all.length > 0 ? `mood:${id}:${ai ? length : 'reviewed'}` : null,
    () => getNarrationMood(all.map((s) => s.text).join(' '), id, (ai?.description ?? artwork?.description)?.mood_keywords ?? []));
  const mood = moodRes.data ?? null;
  useBackgroundMusic(mood?.music_url ?? null, player.playing || player.preparing, musicOn, player.paused);
  const musicNote = !musicOn ? '해설 뒤에 분위기에 맞는 음악을 작게 깔아요'
    : mood ? `${mood.name} 분위기` : moodRes.error ? '음악을 고르지 못했어요' : '분위기에 맞는 음악을 고르는 중이에요…';

  const err = narrationRes.error;
  const missing = !ai && noReviewed;
  const failed = !ai && !!err && !missing;
  const loading = !ai && !narrationRes.data && !err;
  // 작품 위 영역 상자: 검수 해설은 작품 description, AI 해설은 함께 온 description의 regions.
  const regions = ai?.description?.regions ?? artwork?.description?.regions ?? [];
  const usableRegions = new Set(segments.flatMap((s) => (s.region_index === null ? [] : [s.region_index])));
  const jumpToRegion = (region: number) => {
    const at = segments.findIndex((s) => s.region_index === region);
    if (at >= 0) player.goTo(at);
  };
  const total = segments.length;
  const current = segments[player.index];
  const sentenceWeights = segments.map((segment) => Math.max(1, segment.text.replace(/\s/g, '').length));
  const totalWeight = sentenceWeights.reduce((sum, value) => sum + value, 0);
  const totalSeconds = ai?.estimated_seconds ?? totalWeight / 5.5;
  const elapsedWeight = sentenceWeights.slice(0, player.index).reduce((sum, value) => sum + value, 0);
  const sentenceProgress = player.duration > 0 ? Math.min(1, player.currentTime / player.duration) : 0;
  const elapsedSeconds = totalWeight > 0
    ? ((elapsedWeight + (sentenceWeights[player.index] ?? 0) * sentenceProgress) / totalWeight) * totalSeconds
    : 0;

  const reduceMotion = useReducedMotion();
  // 작품 테두리를 그림 비율에 맞춘다.
  // 그림 영역 폭만 재고, 높이는 그림 비율로 정한다(최대 화면의 42%). 가로 그림은 낮아져서 아래 조작 줄이 그림에 붙는다.
  const [stageWidth, setStageWidth] = useState(0);
  const maxStageHeight = Math.max(240, windowHeight * 0.42);
  const [imageRatio, setImageRatio] = useState<{ uri: string; value: number } | null>(null);
  const imageUri = artwork?.image_url ?? '';
  useEffect(() => {
    if (!imageUri) return;
    let alive = true;
    NativeImage.getSize(imageUri, (w, h) => { if (alive && w > 0 && h > 0) setImageRatio({ uri: imageUri, value: w / h }); }, () => {});
    return () => { alive = false; };
  }, [imageUri]);
  const ratio = imageRatio?.uri === imageUri ? imageRatio.value : null;
  const frame = ratio && stageWidth > 0
    ? stageWidth / ratio <= maxStageHeight
      ? { width: stageWidth, height: stageWidth / ratio }
      : { width: maxStageHeight * ratio, height: maxStageHeight }
    : { width: '100%' as const, height: '100%' as const };
  const stageHeight = typeof frame.height === 'number' ? frame.height : maxStageHeight;

  // 읽는 부분 따라가며 확대(켜고 끄기). 재생 중이고 지금 문장에 영역이 있을 때만 확대한다.
  const [follow, setFollow] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const zoomScale = useSharedValue(1);
  const zoomX = useSharedValue(0);
  const zoomY = useSharedValue(0);
  const followRegion = follow && (player.playing || player.preparing) && current?.region_index != null ? regions[current.region_index] : undefined;
  const frameW = typeof frame.width === 'number' ? frame.width : 0;
  const frameH = typeof frame.height === 'number' ? frame.height : 0;
  // 따라 확대 목표(그리는 동안 계산하고, 효과에서는 움직이기만 한다).
  let followScale = 1, followX = 0, followY = 0;
  {
    let scale = 1, tx = 0, ty = 0;
    if (followRegion && frameW > 0 && frameH > 0) {
      const [x, y, w, h] = followRegion.bbox;
      // 영역이 화면의 85%쯤 차도록, 최대 3배까지.
      // 영역 박스 전체가 화면 안에 들어오는 배율까지만 확대한다(가로·세로 모두 88% 이내, 최대 3배).
      // 세로로 긴 영역처럼 거의 확대할 수 없으면 확대 없이 그쪽으로만 옮긴다(옮길 여유가 없으면 그대로).
      scale = Math.max(1, Math.min(3, 0.88 / w, 0.88 / h));
      const cx = (x + w / 2) * frameW;
      const cy = (y + h / 2) * frameH;
      const maxX = ((scale - 1) * frameW) / 2;
      const maxY = ((scale - 1) * frameH) / 2;
      tx = Math.max(-maxX, Math.min(maxX, (frameW / 2 - cx) * scale));
      ty = Math.max(-maxY, Math.min(maxY, (frameH / 2 - cy) * scale));
    }
    followScale = scale; followX = tx; followY = ty;
  }
  useEffect(() => {
    const move = (value: number) => (reduceMotion ? value : withTiming(value, { duration: 600, easing: Easing.inOut(Easing.cubic) }));
    // 따라 확대가 꺼져 있으면 손으로 확대해 둔 상태를 건드리지 않는다.
    if (!follow) {
      // 따라 확대를 끄면 손으로 확대해 둔 게 아니라면 원래 크기로 돌아온다.
      if (!zoomed) { zoomScale.set(move(1)); zoomX.set(move(0)); zoomY.set(move(0)); }
      return;
    }
    zoomScale.set(move(followScale));
    zoomX.set(move(followX));
    zoomY.set(move(followY));
  }, [follow, zoomed, followScale, followX, followY, reduceMotion, zoomScale, zoomX, zoomY]);

  // 손으로 움직이기: 두 손가락으로 벌려 확대(최대 4배), 확대된 상태에서는 한 손가락으로 끌어 이동.
  // 확대 전에는 한 손가락 끌기를 꺼 둬서 화면 스크롤과 부딪히지 않는다.
  const clampX = (value: number, scale: number) => {
    'worklet';
    const max = ((scale - 1) * frameW) / 2;
    return Math.max(-max, Math.min(max, value));
  };
  const clampY = (value: number, scale: number) => {
    'worklet';
    const max = ((scale - 1) * frameH) / 2;
    return Math.max(-max, Math.min(max, value));
  };
  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const next = Math.max(1, Math.min(4, zoomScale.get() * e.scaleChange));
      zoomScale.set(next);
      zoomX.set(clampX(zoomX.get(), next));
      zoomY.set(clampY(zoomY.get(), next));
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(setZoomed, zoomScale.get() > 1.01);
    },
  });
  const pan = usePanGesture({
    enabled: zoomed || (follow && followScale > 1.01),
    minDistance: 6,
    onUpdate: (e) => {
      'worklet';
      const scale = zoomScale.get();
      zoomX.set(clampX(zoomX.get() + e.changeX, scale));
      zoomY.set(clampY(zoomY.get() + e.changeY, scale));
    },
  });
  const imageGestures = useSimultaneousGestures(pinch, pan);
  const followStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zoomX.get() }, { translateY: zoomY.get() }, { scale: zoomScale.get() }],
  }));

  const openZoom = () => {
    if (artwork) setZoomOpen(true);
  };
  useEffect(() => {
    if (!zoomOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setZoomOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [zoomOpen]);

  // 읽는 문장이 바뀌면 사용자가 보던 곳을 따른다.
  // 그림이 화면에 보이고 있거나 따라 확대가 켜져 있으면 그림을 그대로 두고, 아래 문장 목록을 보고 있었으면 그 문장 카드로 스크롤한다.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const rowY = useRef<number[]>([]);
  const listY = useRef(0);
  const scrollY = useRef(0);
  useEffect(() => {
    const y = rowY.current[player.index];
    const lookingAtImage = follow || scrollY.current < stageHeight * 0.5;
    if (player.playing && y !== undefined && !lookingAtImage) {
      scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + y - 160), animated: !reduceMotion });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.index, player.playing, reduceMotion]);
  const atFirst = player.index <= 0;
  const atLast = player.index >= total - 1;


  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
    <SafeAreaView edges={['top']} style={[styles.screen, zoomOpen && styles.hiddenNarration]}
      pointerEvents={zoomOpen ? 'none' : 'auto'} accessibilityElementsHidden={zoomOpen}
      importantForAccessibility={zoomOpen ? 'no-hide-descendants' : 'auto'}>
      <View style={styles.header}>
        <BackButton label="작품으로 돌아가기" palette={palette} />
        <View style={styles.headerTexts}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: palette.text }]}>
            {artwork?.title ?? '음성 해설'}
          </Text>
          {!!artwork?.artist && (
            <Text numberOfLines={1} style={[styles.headerSub, { color: palette.textSecondary }]}>{artwork.artist}</Text>
          )}
        </View>
        {all.length > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="듣는 범위 고르기"
            onPress={() => setListOpen(true)}
            // 아이콘만 보이고 동그란 배경은 없다. 누르는 영역은 56×56 그대로, 누를 때만 옅은 배경이 생긴다.
            pressedScale={0.9}
            background={`${palette.background}00`}
            pressedBackground={palette.fill}
            style={styles.headerButton}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={28} weight="semibold" tintColor={palette.text} />
          </PressableScale>
        ) : <View style={styles.headerSpacer} />}
      </View>

      <ScrollView ref={scrollRef} style={styles.body} scrollEventThrottle={64}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }} contentContainerStyle={[styles.bodyContent, { paddingBottom: total > 0 ? playerBarHeight + 40 : bottomInset }]}>
      {/* 작품: 남는 공간을 모두 쓴다(최소 화면 높이의 40%). 글이 길면 화면 전체가 스크롤된다. */}
      <View style={[styles.stage, { height: stageHeight }]}>
        <View style={styles.stageArea} onLayout={(e) => setStageWidth(e.nativeEvent.layout.width)}>
        {artwork ? (
          // 테두리는 그림 비율에 맞춘다(잘리지 않게). 그림을 누르면 크게 보기, 영역 상자를 누르면 그 설명으로.
          <Pressable accessibilityRole="button" accessibilityLabel={`${artwork.title} 크게 보기`} accessibilityHint="확대해서 볼 수 있어요"
            onPress={openZoom} style={[styles.canvasWrap, frame]}>
            {/* 따라가며 확대가 켜져 있으면 읽는 문장의 영역으로 그림과 상자를 함께 확대·이동한다. */}
            <GestureDetector gesture={imageGestures}>
            <Animated.View style={[styles.followLayer, followStyle]}>
              <CorrectionCanvas
                source={corrected.source}
                overlay={corrected.overlay}
                overlayAmount={corrected.overlayAmount}
                waiting={corrected.loading}
                accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
                correction={{ ...profile, strength }}
                original={false}
                palette={palette}
                style={styles.canvas}
              />
              {/* 작품 속 영역 상자: 누르면 그 부분을 설명하는 문장으로 재생 바가 옮겨 간다. */}
              {regions.length > 0 && !!artwork.image_url && (
                <RegionOverlay imageUri={artwork.image_url} regions={regions} usable={usableRegions}
                  active={current?.region_index ?? null} palette={palette} onPressRegion={jumpToRegion} />
              )}
            </Animated.View>
            </GestureDetector>
          </Pressable>
        ) : <View style={[styles.canvas, styles.canvasPlaceholder, { backgroundColor: palette.surface, borderColor: palette.outline }]} />}
        </View>
      </View>

      {(!profileLoaded || corrected.loading || !!corrected.error) && (
        <View style={styles.lengthWrap}>
          <Text accessibilityLiveRegion="polite" style={[styles.lengthHint, { color: palette.textSecondary }]}>
            {corrected.error ? corrected.error instanceof ApiError ? corrected.error.message : '저장된 보정본을 불러오지 못했어요. 다시 시도해 주세요.' : '저장된 보정값을 적용하고 있어요…'}
          </Text>
          {!!corrected.error && <View style={{ flexDirection: 'row' }}>
            <BigButton label="보정본 다시 불러오기" selected={false} palette={palette} onPress={corrected.reload} />
          </View>}
        </View>
      )}

      {/* 해설 길이: 간결하게(약 1분) · 상세하게(약 3분). 검수 해설이 없어 AI 해설을 들을 때만 고른다. */}
      {noReviewed && (
        <View style={styles.lengthWrap}>
          <SegmentedControl
            accessibilityLabel="해설 길이"
            palette={palette}
            value={length}
            onChange={(next) => { player.reset(); setLength(next); }}
            options={LENGTHS.map((l) => ({ value: l.value, label: l.label, accessibilityLabel: `${l.label}, ${l.hint}` }))}
          />
        </View>
      )}

      {/* 그림 아래 조작 줄: 따라 확대(아이폰식 스위치) · 크게 보기 */}
      {!!artwork && (
        <View style={styles.imageTools}>
          <Pressable disabled={regions.length === 0} accessibilityRole="switch" accessibilityLabel="읽는 부분 따라가며 확대" accessibilityHint="재생할 때 지금 설명하는 부분으로 그림을 확대해요"
              accessibilityState={{ checked: follow, disabled: regions.length === 0 }} onPress={() => setFollow((v) => !v)} style={[styles.followRow, regions.length === 0 && styles.disabled]}>
              <Text style={[styles.followLabel, { color: palette.text }]}>따라 확대</Text>
              <View style={styles.switchBox}>
                <Switch value={follow} onValueChange={setFollow} accessible={false} importantForAccessibility="no"
                  disabled={regions.length === 0}
                  trackColor={{ false: palette.fill, true: palette.highlight }} thumbColor="#FFFFFF" ios_backgroundColor={palette.fill} />
              </View>
            </Pressable>
          <View style={styles.toolButtons}>
          <PressableScale accessibilityRole="button" accessibilityLabel="작품 크게 보기" onPress={openZoom}
            style={[styles.zoomButton, { backgroundColor: palette.fill }]}>
            <SymbolView name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full', web: 'open_in_full' }} size={18} weight="bold" tintColor={palette.text} />
            <Text style={[styles.zoomText, { color: palette.text }]}>크게 보기</Text>
          </PressableScale>
          </View>
        </View>
      )}

      {/* 배경 음악 켜고 끄기(마이페이지 설정과 같은 값). 출처 표시가 필요한 곡이면 출처를 함께 보여 준다. */}
      {all.length > 0 && (
        <View style={styles.musicWrap}>
          <Pressable accessibilityRole="switch" accessibilityLabel={`배경 음악, ${musicNote}`}
            accessibilityState={{ checked: musicOn, disabled: !settingsLoaded }} disabled={!settingsLoaded}
            onPress={() => { void updateSettings({ background_music: !musicOn }); }} style={styles.followRow}>
            <View accessible={false} importantForAccessibility="no-hide-descendants">
              <SymbolView name={{ ios: 'music.note', android: 'music_note', web: 'music_note' }} size={22} tintColor={palette.text} />
            </View>
            <View style={styles.musicTexts}>
              <Text style={[styles.followLabel, { color: palette.text }]}>배경 음악</Text>
              <Text style={[styles.musicNote, { color: palette.textSecondary }]}>{musicNote}</Text>
            </View>
            <View style={styles.switchBox}>
              <Switch value={musicOn} disabled={!settingsLoaded} accessible={false} importantForAccessibility="no"
                onValueChange={(background_music) => { void updateSettings({ background_music }); }}
                trackColor={{ false: palette.fill, true: palette.highlight }} thumbColor="#FFFFFF" ios_backgroundColor={palette.fill} />
            </View>
          </Pressable>
          {musicOn && !!mood?.credit && (
            <Text style={[styles.musicNote, { color: palette.textSecondary }]}>음악 출처: {mood.credit}</Text>
          )}
        </View>
      )}

      {/* 해설 문장을 세로로 모두 보여 준다. 누르면 재생 바가 그 문장으로 옮겨 가며 거기서부터 읽는다. */}
      <View style={styles.captionWrap} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
        {total > 0 ? (
          <View style={styles.list}>
            {player.preparing && <Text accessibilityLiveRegion="polite" style={[styles.status, { color: palette.textSecondary }]}>음성을 준비하고 있어요…</Text>}
            {!!player.error && <Text accessibilityRole="alert" style={[styles.status, { color: palette.text }]}>{player.error}</Text>}
            {ai && <Text style={[styles.status, { color: palette.textSecondary }]}>AI 생성 해설입니다.</Text>}
            {segments.map((s, i) => {
          const now = i === player.index;
          const kind = s.type === 'fact' ? '사실' : '해석';
          return (
            <PressableScale
              key={`${mode}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}번째 문장, ${kind}. ${s.text}`}
              accessibilityHint="이 문장부터 읽어요"
              accessibilityState={{ selected: now }}
              onLayout={(e) => { rowY.current[i] = e.nativeEvent.layout.y; }}
              onPress={() => player.playFrom(i)}
              pressedScale={0.98}
              background={now ? palette.highlight : palette.background}
              pressedBackground={now ? palette.highlight : palette.fill}
              style={[styles.sentence, { borderColor: now ? palette.highlight : palette.outline }]}>
              <View style={styles.sentenceTop}>
                <Text style={[styles.sentenceNo, { color: now ? palette.highlightText : palette.textSecondary }]}>{i + 1}</Text>
                <View style={[styles.tag, { borderColor: now ? palette.highlightText : palette.outline }]}>
                  <Text style={[styles.tagText, { color: now ? palette.highlightText : palette.textSecondary }]}>{kind}</Text>
                </View>
              </View>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.sentenceText, { color: now ? palette.highlightText : palette.text }]}>{s.text}</Text>
            </PressableScale>
          );
            })}
          </View>
        ) : all.length > 0 ? (
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {mode === 'facts' ? '사실 문장이 없어요' : '해석 문장이 없어요'}
          </Text>
        ) : (
          <View style={styles.empty}>
            {(loading || (missing && !aiError)) ? (
              <MascotLoading compact message={loading ? '작품 해설을 확인하고 있어요.' : length === 'detailed' ? 'AI 상세 해설을 준비하고 있어요.' : 'AI 작품 해설을 준비하고 있어요.'} palette={palette} />
            ) : (
              <Text style={[styles.emptyText, { color: palette.text }]}
              >
                {failed ? '해설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요' : '해설을 준비하지 못했어요'}
              </Text>
            )}
            {failed && <PillButton label="다시 시도" palette={palette} onPress={narrationRes.reload} />}
            {missing && aiError && <>
                <Text accessibilityRole="alert" style={[styles.emptyText, { color: palette.text }]}>{aiError}</Text>
                <PillButton label="다시 만들기" palette={palette} onPress={aiRes.reload} />
            </>}
          </View>
        )}
      </View>
      </ScrollView>

      {total > 0 && (
        <BottomActionBar background={palette.background} onHeight={setPlayerBarHeight}>
        <View style={styles.panel}>
          <SeekBar total={total} index={player.index} elapsedSeconds={elapsedSeconds} totalSeconds={totalSeconds}
            palette={palette} onSeek={(i) => player.goTo(i)} />

          <View style={styles.transport}>
            <RoundButton
              ios="repeat.1"
              android="repeat_one"
              label={`이 문장 반복 ${repeat ? '켜짐' : '꺼짐'}`}
              role="switch"
              checked={repeat}
              palette={palette}
              onPress={() => setRepeat((r) => !r)}
            />
            <RoundButton
              ios="backward.end.fill"
              android="skip_previous"
              label={atFirst ? '이전 문장, 첫 문장이에요' : '이전 문장'}
              disabled={atFirst}
              palette={palette}
              onPress={() => player.goTo(player.index - 1)}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={player.playing ? '해설 멈추기' : '해설 듣기'}
              onPress={player.playing ? player.pause : player.play}
              style={({ pressed }) => [styles.play, { backgroundColor: palette.accent, opacity: pressed ? 0.85 : 1 }]}>
              <SymbolView
                name={player.playing ? { ios: 'pause.fill', android: 'pause', web: 'pause' } : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                size={32}
                tintColor={palette.accentText}
              />
            </PressableScale>
            <RoundButton
              ios="forward.end.fill"
              android="skip_next"
              label={atLast ? '다음 문장, 마지막 문장이에요' : '다음 문장'}
              disabled={atLast}
              palette={palette}
              onPress={() => player.goTo(player.index + 1)}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`재생 속도 ${formatRate(rate)}. 누르면 속도를 고를 수 있어요`}
              onPress={() => setSpeedOpen(true)}
              style={({ pressed }) => [styles.round, { backgroundColor: pressed ? palette.highlight : palette.fill }]}>
              {({ pressed }) => (
                <Text style={[styles.speedText, { color: pressed ? palette.highlightText : palette.text }]}>
                  {rate === 1 ? '1배' : `${rate}배`}
                </Text>
              )}
            </PressableScale>
          </View>
        </View>
        </BottomActionBar>
      )}

      <BottomSheet visible={listOpen} title="듣는 범위" palette={palette} onClose={() => setListOpen(false)}>
        <SegmentedControl
          accessibilityLabel="듣는 범위"
          palette={palette}
          value={mode}
          onChange={(next) => { player.reset(); setMode(next); }}
          options={MODES.map((m) => ({ value: m.mode, label: m.label, accessibilityLabel: `${m.label} 듣기` }))}
        />
        <View style={styles.sheetClose}>
          <BigButton label="닫기" selected={false} palette={palette} onPress={() => setListOpen(false)} />
        </View>
      </BottomSheet>

      <SpeedSheet
        visible={speedOpen}
        rate={rate}
        palette={palette}
        onClose={() => setSpeedOpen(false)}
        onSelect={(r) => {
          setSpeedOpen(false);
          if (r === rate) return;
          setRate(r);
          player.changeRate(r);
        }}
      />
    </SafeAreaView>
      {zoomOpen && <Animated.View style={styles.fullscreenArtwork} accessibilityViewIsModal
        entering={reduceMotion ? undefined : FadeIn.duration(120)}
        exiting={reduceMotion ? undefined : FadeOut.duration(120)}>
        <ArtworkZoomView
          artwork={artwork ?? null}
          profile={profile}
          strength={strength}
          player={player}
          sentences={segments.map((segment) => segment.text)}
          narrationFailed={failed || !!aiError}
          onClose={() => setZoomOpen(false)}
        />
      </Animated.View>}

    </View>
  );
}


type RoundButtonProps = {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  disabled?: boolean;
  /** 켜짐/꺼짐 버튼(반복)이면 'switch'. 켜지면 머스타드로 채운다 */
  role?: 'button' | 'switch';
  checked?: boolean;
  palette: Palette;
  onPress: () => void;
};

function RoundButton({ ios, android, label, disabled = false, role = 'button', checked = false, palette, onPress }: RoundButtonProps) {
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'switch' ? { checked, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          backgroundColor: pressed || checked ? palette.highlight : palette.fill,
          opacity: disabled ? 0.35 : 1,
        },
      ]}>
      {({ pressed }) => (
        <SymbolView
          name={{ ios, android, web: android }}
          size={24}
          tintColor={pressed || checked ? palette.highlightText : palette.text}
        />
      )}
    </PressableScale>
  );
}

function PillButton({
  label,
  palette,
  onPress,
  disabled = false,
}: {
  label: string;
  palette: Palette;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: palette.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.pillText, { color: palette.accentText }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hiddenNarration: { opacity: 0 },
  fullscreenArtwork: { ...StyleSheet.absoluteFill, zIndex: 100, backgroundColor: '#000000' },
  lengthWrap: { gap: 6, paddingHorizontal: ScreenPadding, paddingTop: Spacing.three },
  lengthHint: { fontSize: 15, textAlign: 'center' },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  headerTexts: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: FontSize.body, fontWeight: 800, textAlign: 'center' },
  headerSub: { fontSize: 16, fontWeight: 600, textAlign: 'center' },
  headerButton: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: MinTouchTarget },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1 },
  stage: { paddingHorizontal: ScreenPadding },
  stageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvasWrap: { borderRadius: 20, overflow: 'hidden' },
  followLayer: { width: '100%', height: '100%' },
  imageTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: ScreenPadding, paddingTop: 12 },
  followRow: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12 },
  disabled: { opacity: 0.4 },
  followLabel: { fontSize: FontSize.label, lineHeight: 24, fontWeight: 700, includeFontPadding: false, textAlignVertical: 'center' },
  switchBox: { height: MinTouchTarget, justifyContent: 'center' },
  toolButtons: { flexDirection: 'row', gap: Spacing.two },
  musicWrap: { gap: 4, paddingHorizontal: ScreenPadding, paddingTop: 4 },
  musicTexts: { flex: 1, gap: 2 },
  musicNote: { fontSize: 15, lineHeight: 21, fontWeight: 600 },
  zoomButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 22 },
  zoomText: { fontSize: 16, fontWeight: 800 },
  list: { gap: 10 },
  canvas: { height: '100%', borderRadius: 20, borderWidth: 1.5 },
  canvasPlaceholder: { flex: 1 },
  captionWrap: { paddingHorizontal: ScreenPadding, paddingVertical: Spacing.three },
  caption: { gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 20 },
  captionTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  captionCount: { marginLeft: 'auto', fontSize: 16, fontWeight: 700, fontVariant: ['tabular-nums'] },
  captionText: { fontSize: FontSize.body, fontWeight: 600, lineHeight: 32 },
  status: { fontSize: 16, lineHeight: 24, fontWeight: 600 },
  sheetLabel: { fontSize: 16, fontWeight: 700 },
  sheetHint: { fontSize: 16, lineHeight: 24, marginBottom: Spacing.two },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1.5, borderRadius: 10 },
  tagText: { fontSize: 14, fontWeight: 800 },
  modes: { flexDirection: 'row', gap: ButtonGap, marginBottom: Spacing.one },
  mode: {
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderRadius: ButtonRadius,
  },
  modeText: { fontSize: 17, fontWeight: 800 },
  sentence: { gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 20 },
  sentenceTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentenceNo: { fontSize: 16, fontWeight: 800, fontVariant: ['tabular-nums'] },
  sentenceText: { fontSize: FontSize.body, fontWeight: 600, lineHeight: 32 },
  sheetClose: { flexDirection: 'row', marginTop: Spacing.two },
  note: { paddingVertical: Spacing.three, fontSize: FontSize.label, fontWeight: 600, textAlign: 'center' },
  empty: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  emptyText: { fontSize: FontSize.label, fontWeight: 700, lineHeight: 27, textAlign: 'center' },
  pill: {
    minHeight: ButtonHeight,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 17, fontWeight: 800, textAlign: 'center' },
  // 탭 바 없이 하단 안전 영역 바로 위에 고정한다.
  panel: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: { fontSize: 16, fontWeight: 800, fontVariant: ['tabular-nums'] },
  play: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
