/**
 * 해설 재생 바. 손가락을 따라 부드럽게 움직이고(애니메이션 스레드에서 처리), 문장 경계(흰 눈금)에 가까워지면
 * 자석처럼 살짝 걸리며 가볍게 진동한다. 손을 떼면 가장 가까운 문장 시작점에 붙고 그 문장으로 간다.
 * 재생 중에는 문장이 바뀔 때마다 다음 눈금으로 스르륵 이동한다.
 * 보이는 막대는 얇지만 누르는 높이는 48. 스크린리더에서는 '조절 가능' 요소라 위아래로 쓸어 한 문장씩 옮긴다.
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/common/text';
import type { Palette } from '@/constants/a11y';

type Props = {
  total: number;
  index: number;
  elapsedSeconds: number;
  totalSeconds: number;
  palette: Palette;
  onSeek: (index: number) => void;
};

const THUMB = 24;
const HIT = 48;
/** 눈금에서 이만큼(pt) 안쪽이면 자석처럼 끌린다 */
const DETENT = 12;

function formatTime(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function SeekBar({ total, index, elapsedSeconds, totalSeconds, palette, onSeek }: Props) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const w = useSharedValue(0);
  const x = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastTick = useSharedValue(-1);
  const step = total > 1 ? width / total : width;

  // 재생 위치(문장 시작 눈금)로 스르륵. 끄는 중에는 손가락이 우선이다.
  useEffect(() => {
    if (dragging.get() || width <= 0) return;
    const target = total > 0 ? (index / total) * width : 0;
    x.set(reduceMotion ? target : withTiming(target, { duration: 320, easing: Easing.out(Easing.cubic) }));
  }, [index, total, width, reduceMotion, x, dragging]);

  const tick = () => { void Haptics.selectionAsync().catch(() => undefined); };
  const settle = (next: number) => { setPreview(null); onSeek(next); };

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      'worklet';
      dragging.set(true);
      lastTick.set(-1);
      const width_ = w.get();
      x.set(Math.max(0, Math.min(width_, e.x)));
    },
    onUpdate: (e) => {
      'worklet';
      const width_ = w.get();
      if (width_ <= 0 || total <= 0) return;
      const raw = Math.max(0, Math.min(width_, e.x));
      const s = width_ / total;
      const k = Math.round(raw / s);
      const d = raw - k * s;
      // 눈금 근처에서는 손가락보다 덜 움직여 '걸리는' 느낌. 경계(±DETENT)에서 다시 손가락과 같아져 끊기지 않는다.
      x.set(Math.abs(d) < DETENT ? k * s + d * (Math.abs(d) / DETENT) : raw);
      const near = Math.min(total - 1, k);
      if (Math.abs(d) < DETENT / 2 && near !== lastTick.get()) {
        lastTick.set(near);
        scheduleOnRN(tick);
        scheduleOnRN(setPreview, near);
      }
    },
    onFinalize: (e) => {
      'worklet';
      const width_ = w.get();
      dragging.set(false);
      if (width_ <= 0 || total <= 0) return;
      const raw = Math.max(0, Math.min(width_, e.x));
      const next = Math.max(0, Math.min(total - 1, Math.round(raw / (width_ / total))));
      x.set(withTiming((next / total) * width_, { duration: 160 }));
      scheduleOnRN(settle, next);
    },
  });

  const fillStyle = useAnimatedStyle(() => ({ width: x.get() }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() - THUMB / 2 }, { scale: withTiming(dragging.get() ? 1.25 : 1, { duration: 120 }) }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth(next);
    w.set(next);
    x.set(total > 0 ? (index / total) * next : 0);
  };

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="해설 위치"
          accessibilityValue={{ min: 1, max: total, now: index + 1, text: `${total}문장 중 ${index + 1}번째` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') onSeek(Math.min(total - 1, index + 1));
            if (event.nativeEvent.actionName === 'decrement') onSeek(Math.max(0, index - 1));
          }}
          onLayout={onLayout}
          style={styles.hit}>
          <View pointerEvents="none" style={[styles.track, { backgroundColor: palette.fill }]}>
            <Animated.View style={[styles.fill, { backgroundColor: palette.accent }, fillStyle]} />
          </View>
          {/* 문장 경계 눈금(흰색). 막대 위에 얹어 채워진 부분에서도 보인다. */}
          {width > 0 && Array.from({ length: Math.max(0, total - 1) }, (_, i) => (
            <View key={i} pointerEvents="none" style={[styles.tickMark, { left: step * (i + 1) - 1 }]} />
          ))}
          <Animated.View pointerEvents="none" style={[styles.thumb, { backgroundColor: palette.accent, borderColor: palette.background }, thumbStyle]} />
        </View>
      </GestureDetector>
      <Text
        accessibilityLabel={`현재 ${formatTime(elapsedSeconds)}, 전체 ${formatTime(totalSeconds)}`}
        style={[styles.time, { color: palette.textSecondary }]}
      >
        {formatTime(elapsedSeconds)} / {formatTime(totalSeconds)}
      </Text>
      {preview !== null && (
        <Text pointerEvents="none" style={[styles.bubble, { color: palette.text }]}>{preview + 1} / {total}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: HIT, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  // 막대 가운데에서 위쪽 절반만(아래 절반은 없앰). 짧게 두어 막대를 덜 가린다.
  tickMark: { position: 'absolute', top: HIT / 2 - 7, width: 2, height: 7, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  thumb: { position: 'absolute', left: 0, top: (HIT - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3 },
  time: { marginTop: -4, textAlign: 'right', fontSize: 15, fontWeight: 700, fontVariant: ['tabular-nums'] },
  bubble: { position: 'absolute', top: -26, alignSelf: 'center', fontSize: 16, fontWeight: 800, fontVariant: ['tabular-nums'] },
});
