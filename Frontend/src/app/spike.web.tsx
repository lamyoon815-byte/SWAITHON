/**
 * Web stand-in for the FE spike. Skia's CanvasKit is not loaded on web (and not at all during
 * server rendering), so the real spike's module-level shader compile crashes there.
 */

import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FontSize, getPalette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function SpikeScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        기술 검증
      </Text>
      <Text style={[styles.body, { color: palette.textSecondary }]}>
        카메라·Skia 보정은 웹에서 동작하지 않아요. 휴대폰의 Expo Go에서 확인해 주세요.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 800,
  },
  body: {
    fontSize: FontSize.body,
    lineHeight: 30,
  },
});
