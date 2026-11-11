import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/common/text';
import { FontSize, type Palette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';

const MASCOTS = [
  require('@/assets/images/mascot/loading-working.png'),
  require('@/assets/images/mascot/loading-waiting.png'),
] as const;

type Props = {
  message: string;
  palette: Palette;
  detail?: string;
  compact?: boolean;
  overlay?: boolean;
};

/** 긴 AI 작업에서 사용하는 공통 로딩 화면. 두 표정을 번갈아 보여 주고 진행 중임을 함께 알린다. */
export function MascotLoading({
  message,
  palette,
  detail = '잠시만 기다려 주세요.',
  compact = false,
  overlay = false,
}: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % MASCOTS.length), 1400);
    return () => clearInterval(timer);
  }, []);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${message}. ${detail}`}
      style={[
        styles.root,
        compact && styles.compactRoot,
        overlay && [styles.overlay, { backgroundColor: `${palette.background}F5` }],
      ]}>
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.visualRow}>
        <Animated.View
          key={frame}
          entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(180).reduceMotion(ReduceMotion.System)}>
          <Image source={MASCOTS[frame]} contentFit="contain" style={compact ? styles.compactMascot : styles.mascot} />
        </Animated.View>
        <ActivityIndicator size="large" color={palette.highlight} />
      </View>
      <View style={styles.copy}>
        <Text lineBreakStrategyIOS="hangul-word" style={[styles.message, compact && styles.compactMessage, { color: palette.text }]}>{message}</Text>
        <Text style={[styles.detail, { color: palette.textSecondary }]}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.four },
  compactRoot: { paddingVertical: Spacing.two },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, elevation: 100 },
  visualRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  mascot: { width: 190, height: 190 },
  compactMascot: { width: 132, height: 132 },
  copy: { alignItems: 'center', gap: Spacing.one },
  message: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 800, textAlign: 'center' },
  compactMessage: { fontSize: FontSize.body, lineHeight: 30 },
  detail: { fontSize: FontSize.label, lineHeight: 27, fontWeight: 600, textAlign: 'center' },
});
