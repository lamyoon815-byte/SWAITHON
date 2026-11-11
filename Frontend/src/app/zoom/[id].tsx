// 작품 크게 보기 (디자인 "저시력 미술관 앱"의 작품 확대). 작품 상세의 이미지나 "확대"에서 들어온다
/**
 * 탭 바 없는 검은 전체 화면. 두 손가락으로 확대·이동, 두 번 눌러 확대, 아래 버튼으로도 확대한다
 * (스크린리더를 켜면 핀치가 막혀서 버튼이 꼭 필요하다). 보정본/원본은 상세 화면에서 고른 대로 보여 준다.
 * 화면은 테마와 상관없이 항상 어둡게 둔다 (작품에 눈이 가도록).
 * 아래 '해설 듣기'로 크게 본 채로 음성 해설을 듣는다. 지금 읽는 문장은 작품 아래 자막으로 보인다.
 * 검수 해설이 없으면 해설 화면과 같은 방식으로 AI 해설을 만들어 그 자리에서 바로 들려준다(같은 캐시를 쓴다).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { PressableScale } from '@/components/common/pressable-scale';
import { ButtonHeight, ButtonRadius, FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { useHistory } from '@/hooks/use-history';
import { ApiError, generateNarration, getArtwork, getNarration } from '@/lib/api';
import { useNarrationPlayer } from '@/hooks/use-narration-player';

import { useCorrectedArtwork } from '@/hooks/use-corrected-artwork';
import { viewingFromProfile } from '@/lib/calibration';

export default function ZoomScreen() {
  const { profile: currentProfile } = useProfile();
  const { items: historyItems, loaded: historyLoaded } = useHistory();
  const palette = getPalette('dark', false);
  const { id, original, strength, history: historyId } = useLocalSearchParams<{
    id: string;
    original?: string;
    /** 상세 화면의 보정 강도(0~1). 없으면 프로필 값 */
    strength?: string;
    history?: string;
  }>();
  const historyRecord = historyItems.find((item) => item.id === historyId && item.artwork.id === id);
  const profile = currentProfile;
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const showOriginal = original === '1';
  const rawStrength = Number(strength ?? profile.strength);
  const amount = Number.isFinite(rawStrength) ? Math.max(0, Math.min(1, rawStrength)) : 1;
  const corrected = useCorrectedArtwork(artwork?.id, artwork?.image_url, viewingFromProfile(profile), showOriginal, amount);
  // 해설 화면과 같은 키라서 이미 받아 둔 해설을 다시 받지 않는다.
  const mode = currentProfile.narration_mode;
  const narration = useResource(id ? `narration:${id}:${mode}` : null, () => getNarration(id!, mode));
  const noReviewed = narration.error instanceof ApiError && narration.error.status === 409;
  const aiNarration = useResource(noReviewed && id ? `ai-narration:${id}` : null, () => generateNarration(id!));
  const allSegments = aiNarration.data?.segments ?? narration.data?.segments ?? [];
  const segments = allSegments.filter((s) => mode === 'both' || (mode === 'facts' ? s.type === 'fact' : s.type === 'interpretation'));
  const player = useNarrationPlayer(segments.map((segment) => segment.text), currentProfile.speech_rate, false);
  const current = segments[player.index];
  const showCaption = !!current && (player.playing || player.preparing || player.index > 0);
  const failed = (narration.error && !noReviewed) || !!aiNarration.error;
  const audioLabel = failed ? '해설을 못 불러왔어요' : segments.length === 0 ? '해설 준비 중…'
    : player.preparing ? '음성 준비 중…' : player.playing ? '해설 멈추기' : player.index > 0 ? '이어서 듣기' : '해설 듣기';
  const audioDisabled = segments.length === 0;

  return (
    // A full-screen modal is its own native window, so pinch needs its own gesture root here.
    <GestureHandlerRootView style={styles.screen}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.title, { color: palette.text }]}>
            {artwork?.title ?? ''}
          </Text>
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            {showOriginal ? '원본 · ' : '보정본 · '}두 손가락으로 벌리거나 아래 버튼으로 확대해요
          </Text>
        </View>

        {artwork && (!historyId || (historyLoaded && historyRecord)) ? (
          <CorrectionCanvas
            source={corrected.source}
            overlay={corrected.overlay}
            overlayAmount={corrected.overlayAmount}
            accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
            correction={{ ...profile, strength: amount }}
            original={showOriginal}
            zoomable
            palette={palette}
            containerStyle={styles.canvasArea}
            style={styles.canvas}
          />
        ) : (
          <View style={styles.canvasArea}>
            {(!!error || (historyId && historyLoaded && !historyRecord)) && (
              <Text style={[styles.message, { color: palette.text }]}>
                {historyId && !historyRecord ? '관람 기록을 불러오지 못했어요. 기록 화면에서 다시 선택해 주세요.' : '작품 이미지를 불러오지 못했어요'}
              </Text>
            )}
          </View>
        )}

        {showCaption && (
          <View accessibilityLiveRegion="polite" style={[styles.caption, { backgroundColor: palette.surface }]}>
            <Text style={[styles.captionCount, { color: palette.textSecondary }]}
              accessibilityLabel={`${segments.length}문장 중 ${player.index + 1}번째`}>
              {player.index + 1} / {segments.length}
            </Text>
            <Text numberOfLines={3} lineBreakStrategyIOS="hangul-word" style={[styles.captionText, { color: palette.text }]}>{current.text}</Text>
          </View>
        )}
        {!!player.error && <Text accessibilityRole="alert" style={[styles.message, styles.error, { color: palette.text }]}>{player.error}</Text>}

        <View style={styles.footer}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="닫기"
            accessibilityHint="작품 상세로 돌아가요"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.close,
              styles.closeSide,
              { backgroundColor: palette.fill, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Text style={[styles.closeText, { color: palette.text }]}>닫기</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={audioLabel}
            accessibilityHint="크게 본 채로 음성 해설을 들어요"
            accessibilityState={{ disabled: audioDisabled, busy: player.preparing }}
            disabled={audioDisabled}
            onPress={player.playing ? player.pause : player.play}
            style={({ pressed }) => [
              styles.close,
              styles.audio,
              { backgroundColor: palette.accent, opacity: audioDisabled ? 0.5 : pressed ? 0.8 : 1 },
            ]}>
            <SymbolView
              name={player.playing ? { ios: 'pause.fill', android: 'pause', web: 'pause' } : { ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
              size={22}
              tintColor={palette.accentText}
            />
            <Text numberOfLines={1} style={[styles.closeText, { color: palette.accentText }]}>{audioLabel}</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  top: {
    gap: 4,
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  title: {
    fontSize: FontSize.body,
    fontWeight: 800,
    textAlign: 'center',
  },
  hint: {
    fontSize: 16,
    fontWeight: 600,
    textAlign: 'center',
  },
  canvasArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  canvas: {
    flex: 1,
    height: undefined,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: '#000000',
  },
  message: {
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
  caption: {
    gap: 4,
    marginHorizontal: ScreenPadding,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: 16,
  },
  captionCount: {
    fontSize: 14,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  captionText: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 27,
  },
  error: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  closeSide: { flex: 1 },
  audio: { flex: 2, flexDirection: 'row', gap: Spacing.two },
  close: {
    minHeight: ButtonHeight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
});
