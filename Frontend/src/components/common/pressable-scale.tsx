/**
 * 누르면 살짝 작아졌다가(0.97배) 놓으면 원래 크기로 돌아오는 Pressable (토스식 누름 느낌).
 * `Pressable` 자리에 그대로 바꿔 끼우면 된다: `style`·`children`에 함수(`({ pressed }) => …`)도 그대로 쓴다.
 * 놓을 때 튀어 오르지 않고 곧장 원래 크기로 돌아간다. "동작 줄이기"를 켜면 크기는 바뀌지 않는다.
 * `background`·`pressedBackground`를 주면 누르는 동안 배경이 회색으로 스르륵 바뀌었다가 돌아온다(토스 카드 누름).
 * 이때 `style` 안에서 배경색은 주지 않는다(애니메이션이 덮어쓴다).
 */

import { useState, type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
  /** 눌렀을 때 크기. 기본 0.97, 넓은 카드는 0.98 정도 */
  pressedScale?: number;
  /** 평소 배경색. `pressedBackground`와 함께 줘야 한다. 투명이면 'transparent' 대신 같은 색의 #RRGGBB00 */
  background?: string;
  /** 누르는 동안 배경색 (보통 palette.fill) */
  pressedBackground?: string;
};

export function PressableScale({ style, children, pressedScale = 0.97, background, pressedBackground, onPressIn, onPressOut, ...rest }: Props) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const tint = useSharedValue(0);
  const fade = background !== undefined && pressedBackground !== undefined;
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    ...(fade ? { backgroundColor: interpolateColor(tint.get(), [0, 1], [background, pressedBackground]) } : {}),
  }));
  const state = { pressed, hovered: false };

  const pressIn = (event: GestureResponderEvent) => {
    setPressed(true);
    if (!reduceMotion) scale.set(withTiming(pressedScale, { duration: 90 }));
    tint.set(withTiming(1, { duration: 90 }));
    onPressIn?.(event);
  };
  const pressOut = (event: GestureResponderEvent) => {
    setPressed(false);
    if (!reduceMotion) scale.set(withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }));
    tint.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }));
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[typeof style === 'function' ? style(state) : style, scaleStyle]}>
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  );
}
