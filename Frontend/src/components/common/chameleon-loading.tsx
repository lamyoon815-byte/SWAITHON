import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/common/text';
import type { Palette } from '@/constants/a11y';

/** MoMi 카멜레온이 살짝 떠올랐다 내려오며 기다리는 동안을 알려 준다. 동작 줄이기 설정이면 움직이지 않는다. */
export function ChameleonLoading({ label, palette, size = 120 }: { label: string; palette: Palette; size?: number }) {
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    lift.set(withRepeat(withSequence(
      withTiming(-8, { duration: 500, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 500, easing: Easing.inOut(Easing.quad) }),
    ), -1));
  }, [lift, reduceMotion]);
  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));

  return (
    <View style={styles.wrap} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite">
      <Animated.View style={bob}>
        <Image
          source={require('@/assets/images/mascot/chameleon.png')}
          contentFit="contain"
          style={{ width: size, height: size }}
          accessible={false}
        />
      </Animated.View>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  label: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
});
