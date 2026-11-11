import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { Text } from '@/components/common/text';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { PressableScale } from '@/components/common/pressable-scale';
import { ButtonHeight, ButtonRadius, FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useCorrectedArtwork } from '@/hooks/use-corrected-artwork';
import type { useNarrationPlayer } from '@/hooks/use-narration-player';
import { viewingFromProfile } from '@/lib/calibration';
import type { Artwork } from '@/types/artwork';
import type { VisualProfile } from '@/types/profile';

type Props = {
  artwork: Artwork | null;
  profile: VisualProfile;
  original?: boolean;
  strength: number;
  player: Pick<ReturnType<typeof useNarrationPlayer>, 'index' | 'playing' | 'preparing' | 'error' | 'pause' | 'play'>;
  sentences: string[];
  narrationFailed?: boolean;
  imageError?: string;
  onClose: () => void;
  /** 따라 확대(해설 화면과 같은 설정). 영역 정보가 없는 작품이면 주지 않는다 */
  follow?: { on: boolean; onChange: (on: boolean) => void; region: readonly [number, number, number, number] | null };
};

/** Presentation only: the caller owns the audio player, so enlarging an image never restarts audio. */
export function ArtworkZoomView({ artwork, profile, original = false, strength: amount,
  player, sentences, narrationFailed = false, imageError, onClose, follow }: Props) {
  const palette = getPalette('dark', false);
  const showOriginal = original;
  const corrected = useCorrectedArtwork(artwork?.id, artwork?.image_url, viewingFromProfile(profile), showOriginal, amount, undefined);
  const current = sentences[player.index];
  const showCaption = !!current && (player.playing || player.preparing || player.index > 0);
  const audioLabel = narrationFailed ? '해설을 못 불러왔어요' : sentences.length === 0 ? '해설 준비 중…'
    : player.preparing ? '음성 준비 중…' : player.playing ? '해설 멈추기' : player.index > 0 ? '이어서 듣기' : '해설 듣기';
  const audioDisabled = sentences.length === 0;

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
            {showOriginal ? '원본 · ' : '보정본 · '}두 손가락으로 벌리거나 오른쪽 버튼으로 확대해요
          </Text>
          {follow && (
            <Pressable accessibilityRole="switch" accessibilityLabel="읽는 부분 따라가며 확대" accessibilityHint="재생할 때 지금 설명하는 부분으로 그림을 확대해요"
              accessibilityState={{ checked: follow.on }} onPress={() => follow.onChange(!follow.on)} style={styles.followRow}>
              <Text style={[styles.followLabel, { color: palette.text }]}>따라 확대</Text>
              <Switch value={follow.on} onValueChange={follow.onChange} accessible={false} importantForAccessibility="no"
                trackColor={{ false: palette.fill, true: palette.highlight }} thumbColor="#FFFFFF" ios_backgroundColor={palette.fill} />
            </Pressable>
          )}
        </View>

        {artwork ? (
          <CorrectionCanvas
            source={corrected.source}
            overlay={corrected.overlay}
            overlayAmount={corrected.overlayAmount}
            waiting={corrected.loading}
            accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
            correction={{ ...profile, strength: amount }}
            original={showOriginal}
            zoomable
            focus={follow?.on ? follow.region : undefined}
            palette={palette}
            containerStyle={styles.canvasArea}
            style={styles.canvas}
          />
        ) : (
          <View style={styles.canvasArea}>
            {!!imageError && (
              <Text style={[styles.message, { color: palette.text }]}>
                {imageError}
              </Text>
            )}
          </View>
        )}

        {showCaption && (
          <View accessibilityLiveRegion="polite" style={[styles.caption, { backgroundColor: palette.surface }]}>
            <Text style={[styles.captionCount, { color: palette.textSecondary }]}
              accessibilityLabel={`${sentences.length}문장 중 ${player.index + 1}번째`}>
              {player.index + 1} / {sentences.length}
            </Text>
            <Text numberOfLines={3} lineBreakStrategyIOS="hangul-word" style={[styles.captionText, { color: palette.text }]}>{current}</Text>
          </View>
        )}
        {!!player.error && <Text accessibilityRole="alert" style={[styles.message, styles.error, { color: palette.text }]}>{player.error}</Text>}

        <View style={styles.footer}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="닫기"
            accessibilityHint="이전 화면으로 돌아가요"
            onPress={onClose}
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
  followRow: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  followLabel: { fontSize: FontSize.label, fontWeight: 700 },
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
    fontSize: 16,
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
