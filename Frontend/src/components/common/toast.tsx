/**
 * 화면 아래 잠깐 뜨는 안내. 화면을 넘어가도 남아 있도록 탭 레이아웃에 `ToastHost`를 하나 두고,
 * 어디서든 `showToast`로 띄운다. 스크린리더에도 같은 문장을 읽어 준다.
 */

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { FontSize, getPalette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarBottom, TabBarHeight } from '@/hooks/use-tab-bar-inset';

const DURATION_MS = 2600;

let message = '';
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: string) {
  message = next;
  listeners.forEach((l) => l());
}

export function showToast(text: string) {
  clearTimeout(timer);
  set(text);
  AccessibilityInfo.announceForAccessibility(text);
  timer = setTimeout(() => set(''), DURATION_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getMessage = () => message;

export function ToastHost() {
  const text = useSyncExternalStore(subscribe, getMessage, getMessage);
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottom = useTabBarBottom() + TabBarHeight + Spacing.three;

  if (!text) return null;
  return (
    <View
      accessibilityRole="alert"
      pointerEvents="none"
      style={[styles.toast, { bottom, backgroundColor: palette.highlight }]}>
      <Text style={[styles.text, { color: palette.highlightText }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.four,
    borderRadius: 28,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  text: {
    fontSize: FontSize.label,
    fontWeight: 800,
    lineHeight: 24,
    textAlign: 'center',
  },
});
