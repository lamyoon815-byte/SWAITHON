// 와이어프레임 3 해설 재생. 작품 상세의 "음성 해설 듣기"에서 들어온다
/**
 * 작품을 크게 보면서 듣는 화면. 위에서부터 작품(보정 적용, 화면 대부분) → 지금 읽는 문장(자막 카드) →
 * 아래 고정 재생판(진행 · 반복 · 이전 · 재생/멈춤 · 다음 · 속도).
 * 전체 문장과 듣는 범위(전체 · 사실 · 해석)는 오른쪽 위 "문장 목록" 시트에서 고른다. 문장을 누르면 거기서부터 읽는다.
 * 사실/해석은 색이 아니라 "사실"·"해석" 글자 표시로 구분한다.
 * 검수 해설이 없으면(409) 안내만 보여 준다. 개발 빌드에서는 예시 문장으로 화면을 확인할 수 있다.
 */

import { useLocalSearchParams } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
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
import { ScreenPadding, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNarrationPlayer } from '@/hooks/use-narration-player';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { ApiError, getArtwork, getNarration } from '@/lib/api';
import type { NarrationMode, NarrationSegment } from '@/types/narration';
import { DEFAULT_PROFILE } from '@/types/profile';

const START_RATE = DEFAULT_PROFILE.speech_rate;

const MODES: { mode: NarrationMode; label: string }[] = [
  { mode: 'both', label: '전체' },
  { mode: 'facts', label: '사실' },
  { mode: 'interpretations', label: '해석' },
];

/** 개발 빌드에서만. 작품에 대한 내용이 아니라 화면 확인용이라는 것을 문장 자체로 밝힌다. */
const DEV_SAMPLE: NarrationSegment[] = [
  { type: 'fact', text: '화면 확인용 예시 문장입니다. 첫 번째 문장이에요.', region_index: null },
  { type: 'fact', text: '지금 읽는 문장은 노란 카드로 바뀌어요.', region_index: null },
  { type: 'fact', text: '문장을 누르면 그 문장부터 다시 읽어요.', region_index: null },
  {
    type: 'interpretation',
    text: '가능한 감정적 해석입니다. 해석 문장에는 해석 표시가 붙어요.',
    region_index: null,
  },
  {
    type: 'interpretation',
    text: '가능한 감정적 해석입니다. 마지막 예시 문장이에요.',
    region_index: null,
  },
];

export default function NarrationScreen() {
  const { profile, loaded: profileLoaded } = useProfile();
  const [selectedMode, setMode] = useState<NarrationMode | null>(null);
  const mode = selectedMode ?? profile.narration_mode;
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottomInset = useTabBarInset();
  const { id, strength: strengthParam, original: originalParam } = useLocalSearchParams<{ id: string; strength?: string; original?: string }>();
  const strength = strengthParam !== undefined && !Number.isNaN(Number(strengthParam)) ? Number(strengthParam) : profile.strength;
  const { data: artwork } = useResource(id ?? null, () => getArtwork(id!));
  const narrationRes = useResource(id && profileLoaded ? `narration:${id}:${mode}` : null, () => getNarration(id!, mode));
  const [sample, setSample] = useState(false);
  const [rate, setRate] = useState(START_RATE);
  const [repeat, setRepeat] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const all = sample ? DEV_SAMPLE : (narrationRes.data?.segments ?? []);
  const segments = all.filter(
    (s) => mode === 'both' || (mode === 'facts' ? s.type === 'fact' : s.type === 'interpretation'),
  );
  const player = useNarrationPlayer(
    segments.map((s) => s.text),
    rate,
    repeat,
  );

  const err = narrationRes.error;
  const missing = !sample && err instanceof ApiError && (err.status === 409 || err.status === 404);
  const failed = !sample && !!err && !missing;
  const loading = !sample && !narrationRes.data && !err;
  const total = segments.length;
  const current = segments[player.index];
  const atFirst = player.index <= 0;
  const atLast = player.index >= total - 1;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="문장 목록과 듣는 범위"
            onPress={() => setListOpen(true)}
            style={({ pressed }) => [styles.headerButton, { backgroundColor: pressed ? palette.highlight : palette.fill }]}>
            {({ pressed }) => (
              <SymbolView name={{ ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }} size={24} weight="semibold" tintColor={pressed ? palette.highlightText : palette.text} />
            )}
          </Pressable>
        ) : <View style={styles.headerSpacer} />}
      </View>

      {/* 작품: 남는 공간을 모두 쓴다. */}
      <View style={styles.stage}>
        {artwork ? (
          <CorrectionCanvas
            source={artwork.image_url}
            accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
            correction={{ ...profile, strength }}
            original={originalParam === '1'}
            palette={palette}
            style={styles.canvas}
          />
        ) : <View style={[styles.canvas, styles.canvasPlaceholder, { backgroundColor: palette.surface, borderColor: palette.outline }]} />}
      </View>

      {/* 지금 읽는 문장: 자막처럼 작품 바로 아래 */}
      <View style={styles.captionWrap}>
        {total > 0 && current ? (
          <View accessibilityLiveRegion="polite" style={[styles.caption, cardSurface(palette)]}>
            <View style={styles.captionTop}>
              <View style={[styles.tag, { borderColor: palette.outline }]}>
                <Text style={[styles.tagText, { color: palette.textSecondary }]}>{current.type === 'fact' ? '사실' : '해석'}</Text>
              </View>
              {player.playing && (
                <SymbolView name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }} size={18} tintColor={palette.highlight} />
              )}
              <Text accessibilityLabel={`${total}문장 중 ${player.index + 1}번째`} style={[styles.captionCount, { color: palette.textSecondary }]}>
                {player.index + 1} / {total}
              </Text>
            </View>
            <ScrollView style={styles.captionScroll} showsVerticalScrollIndicator>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.captionText, { color: palette.text }]}>{current.text}</Text>
            </ScrollView>
          </View>
        ) : all.length > 0 ? (
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {mode === 'facts' ? '사실 문장이 없어요' : '해석 문장이 없어요'}
          </Text>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.text }]}>
              {loading
                ? '해설을 불러오는 중이에요'
                : failed
                  ? '해설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요'
                  : '아직 검수된 해설이 없어요'}
            </Text>
            {failed && <PillButton label="다시 시도" palette={palette} onPress={narrationRes.reload} />}
            {missing && __DEV__ && (
              <PillButton label="예시 문장으로 화면 보기 (개발용)" palette={palette} onPress={() => setSample(true)} />
            )}
          </View>
        )}
      </View>

      {total > 0 && (
        <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.outline, paddingBottom: bottomInset + Spacing.two }]}>
          <View style={[styles.track, { backgroundColor: palette.fill }]}>
            <View style={[styles.trackFill, { backgroundColor: palette.accent, width: `${((player.index + 1) / total) * 100}%` }]} />
          </View>

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={player.playing ? '해설 멈추기' : '해설 듣기'}
              onPress={player.playing ? player.pause : player.play}
              style={({ pressed }) => [styles.play, { backgroundColor: palette.accent, opacity: pressed ? 0.85 : 1 }]}>
              <SymbolView
                name={player.playing ? { ios: 'pause.fill', android: 'pause', web: 'pause' } : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                size={32}
                tintColor={palette.accentText}
              />
            </Pressable>
            <RoundButton
              ios="forward.end.fill"
              android="skip_next"
              label={atLast ? '다음 문장, 마지막 문장이에요' : '다음 문장'}
              disabled={atLast}
              palette={palette}
              onPress={() => player.goTo(player.index + 1)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`재생 속도 ${formatRate(rate)}. 누르면 속도를 고를 수 있어요`}
              onPress={() => setSpeedOpen(true)}
              style={({ pressed }) => [styles.round, { backgroundColor: pressed ? palette.highlight : palette.fill }]}>
              {({ pressed }) => (
                <Text style={[styles.speedText, { color: pressed ? palette.highlightText : palette.text }]}>
                  {rate === 1 ? '1배' : `${rate}배`}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      <BottomSheet visible={listOpen} title="문장 목록" palette={palette} onClose={() => setListOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel="듣는 범위" style={styles.modes}>
          {MODES.map((m) => {
            const on = m.mode === mode;
            return (
              <Pressable
                key={m.mode}
                accessibilityRole="radio"
                accessibilityLabel={`${m.label} 듣기`}
                accessibilityState={{ checked: on }}
                onPress={() => {
                  if (on) return;
                  player.reset();
                  setMode(m.mode);
                }}
                style={({ pressed }) => [
                  styles.mode,
                  on
                    ? { backgroundColor: palette.highlight, borderColor: palette.highlight }
                    : { backgroundColor: palette.surface, borderColor: palette.outline },
                  pressed && !on && { backgroundColor: palette.fill },
                ]}>
                {/* The ✓ slot is always there, so selecting never moves the label. */}
                <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={16} weight="bold" tintColor={palette.highlightText} style={{ opacity: on ? 1 : 0 }} />
                <Text style={[styles.modeText, { color: on ? palette.highlightText : palette.text }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {total === 0 ? (
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {mode === 'facts' ? '사실 문장이 없어요' : '해석 문장이 없어요'}
          </Text>
        ) : segments.map((s, i) => {
          const now = i === player.index;
          const kind = s.type === 'fact' ? '사실' : '해석';
          return (
            <Pressable
              key={`${mode}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}번째 문장, ${kind}. ${s.text}`}
              accessibilityHint="이 문장부터 읽어요"
              accessibilityState={{ selected: now }}
              onPress={() => {
                setListOpen(false);
                player.playFrom(i);
              }}
              style={({ pressed }) => [
                styles.sentence,
                now ? { backgroundColor: palette.highlight, borderColor: palette.highlight } : { backgroundColor: palette.background, borderColor: palette.outline },
                pressed && !now && { backgroundColor: palette.fill },
              ]}>
              <View style={styles.sentenceTop}>
                <Text style={[styles.sentenceNo, { color: now ? palette.highlightText : palette.textSecondary }]}>{i + 1}</Text>
                <View style={[styles.tag, { borderColor: now ? palette.highlightText : palette.outline }]}>
                  <Text style={[styles.tagText, { color: now ? palette.highlightText : palette.textSecondary }]}>{kind}</Text>
                </View>
              </View>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.sentenceText, { color: now ? palette.highlightText : palette.text }]}>{s.text}</Text>
            </Pressable>
          );
        })}
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
  );
}

function cardSurface(palette: Palette) {
  return { backgroundColor: palette.surface, borderColor: palette.outline };
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
    <Pressable
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
    </Pressable>
  );
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
  stage: { flex: 1, minHeight: 200, paddingHorizontal: ScreenPadding },
  canvas: { height: '100%', borderRadius: 20, borderWidth: 1.5 },
  canvasPlaceholder: { flex: 1 },
  captionWrap: { paddingHorizontal: ScreenPadding, paddingVertical: Spacing.three },
  caption: { gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 20 },
  captionTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  captionCount: { marginLeft: 'auto', fontSize: 16, fontWeight: 700, fontVariant: ['tabular-nums'] },
  captionScroll: { maxHeight: 132 },
  captionText: { fontSize: FontSize.body, fontWeight: 600, lineHeight: 32 },
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
  // Fixed at the bottom, above the floating tab bar (its inset is the bottom padding).
  panel: {
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    borderTopWidth: 1.5,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    boxShadow: Shadow.floating,
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
