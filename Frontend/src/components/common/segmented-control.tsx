import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text as NativeText, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/common/text';
import { FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';

type Option<T extends string> = { value: T; label: string; accessibilityLabel?: string; /** 글씨 크기 선택용. 현재 앱 배율 대신 이 배율로 보여준다. 시스템 배율은 유지한다. */ previewScale?: number };

type Props<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  palette: Palette;
  /** 스크린리더가 읽는 묶음 이름. 예: "보기 방식" */
  accessibilityLabel: string;
  disabled?: boolean;
};

/** 하단 탭 바(홈·카메라·마이)의 선택 알약과 같은 스프링. 앱 안의 "미끄러지는 선택"은 모두 같은 느낌으로 움직인다. */
const Slide = { damping: 22, stiffness: 260, mass: 0.9 };
const BORDER = 1.5;
const PADDING = 4;
const GAP = 4;

/** 바 바깥 폭에서 테두리·안쪽 여백·칸 사이를 뺀 한 칸의 폭 */
function segmentWidth(outer: number, count: number) {
  return (outer - BORDER * 2 - PADDING * 2 - GAP * (count - 1)) / count;
}

/**
 * 둘·셋 중 하나를 고르는 바(토스식 세그먼트). 머스타드 선택 칸이 하단 탭 바처럼 고른 칸으로 미끄러진다.
 * ✓ 같은 추가 표시가 없어서 고를 때 글자가 움직이지 않고, 칸 너비는 항상 같다.
 * 색만으로 구분하지 않도록 선택 칸은 채움 + 굵기, 스크린리더는 "선택됨"으로 읽는다.
 * "동작 줄이기"를 켜면 미끄러지지 않고 바로 옮겨 간다.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, palette, accessibilityLabel, disabled }: Props<T>) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const segment = width > 0 ? segmentWidth(width, options.length) : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    const target = index * (segment + GAP);
    // 처음 그릴 때(폭을 막 잰 때)는 미끄러지지 않고 제자리에 둔다.
    x.set(reduceMotion || segment === 0 ? target : withSpring(target, Slide));
  }, [index, segment, reduceMotion, x]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next !== width) {
      // 폭이 바뀌면 애니메이션 없이 새 자리로 맞춘다.
      x.set(index * (segmentWidth(next, options.length) + GAP));
      setWidth(next);
    }
  };

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} onLayout={onLayout}
      style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.outline, opacity: disabled ? 0.4 : 1 }]}>
      {segment > 0 && (
        <Animated.View pointerEvents="none"
          style={[styles.indicator, { width: segment, backgroundColor: palette.highlight }, indicator]} />
      )}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ checked: active, disabled }}
            disabled={disabled}
            onPress={() => { if (!active) onChange(option.value); }}
            style={({ pressed }) => [styles.segment, option.previewScale !== undefined && styles.previewSegment, { backgroundColor: pressed && !active ? palette.fill : 'transparent' }]}>
            {option.previewScale !== undefined ? <NativeText
              lineBreakStrategyIOS="hangul-word"
              style={[styles.label, { fontSize: FontSize.label * option.previewScale, lineHeight: Math.ceil(FontSize.label * option.previewScale * 1.5), color: active ? palette.highlightText : palette.textSecondary, fontWeight: active ? 800 : 600 }]}>{option.label}</NativeText> : <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
              style={[styles.label, { color: active ? palette.highlightText : palette.textSecondary, fontWeight: active ? 800 : 600 }]}>
              {option.label}
            </Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderWidth: BORDER, borderRadius: 14, padding: PADDING, gap: GAP },
  indicator: { position: 'absolute', top: PADDING, bottom: PADDING, left: PADDING, borderRadius: 10 },
  segment: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  previewSegment: { minHeight: MinTouchTarget, paddingVertical: 8 },
  label: { fontSize: FontSize.label, textAlign: 'center' },
});
