/**
 * 화면 아래에서 올라왔다가 내려가는 짧은 안내 (토스 스타일 알약). 화면을 넘어가도 남아 있도록
 * 루트 레이아웃에 `ToastHost`를 하나 두고, 어디서든 `showToast(문구, 종류)`로 띄운다.
 * 스크린리더에도 같은 문장을 읽어 준다.
 *
 * 종류(kind)마다 아이콘 모양이 다르다 (ⓘ 안내 · ✓ 확인 · ! 주의 · ✕ 오류). 색만으로 구분하지 않는다.
 */

import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated';

import { FontSize } from '@/constants/a11y';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarBottom, TabBarHeight } from '@/hooks/use-tab-bar-inset';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/**
 * 3.5 s: Toss's TDS default is 3 s, a little longer here because low-vision users read slowly.
 * Long messages stay longer (about 0.09 s a character, so 40+ characters go past 3.5 s).
 * Tapping closes it early.
 */
const MIN_DURATION_MS = 3500;
const MS_PER_CHAR = 90;

/**
 * Icon colors sit on the toast's own dark pill in both themes, so one set works for light and dark.
 * Each is at least 3:1 against both pill colors (#3A3D44, #33353B), the non-text contrast minimum.
 */
const KINDS: Record<ToastKind, { ios: SFSymbol; android: AndroidSymbol; color: string; label: string }> = {
  info: { ios: 'info.circle.fill', android: 'info', color: '#8FB0FF', label: '안내' },
  success: { ios: 'checkmark.circle.fill', android: 'check_circle', color: '#5BD69A', label: '완료' },
  warning: { ios: 'exclamationmark.circle.fill', android: 'error', color: '#FFC845', label: '주의' },
  error: { ios: 'xmark.circle.fill', android: 'cancel', color: '#FF8A80', label: '오류' },
};

type Toast = { id: number; text: string; kind: ToastKind };

let current: Toast | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Toast | null) {
  current = next;
  listeners.forEach((l) => l());
}

export function showToast(text: string, kind: ToastKind = 'info') {
  clearTimeout(timer);
  // A new id remounts the pill, so a second message slides in again instead of swapping in place.
  set({ id: nextId++, text, kind });
  AccessibilityInfo.announceForAccessibility(text);
  timer = setTimeout(() => set(null), Math.max(MIN_DURATION_MS, text.length * MS_PER_CHAR));
}

function dismiss() {
  clearTimeout(timer);
  set(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getToast = () => current;

/** 열린 키보드 높이(닫혀 있으면 0). iOS는 키보드가 움직이기 시작할 때, Android는 다 열린 뒤에 알 수 있다. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getToast, getToast);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tabBarBottom = useTabBarBottom();
  const keyboard = useKeyboardHeight();
  // 키보드가 열려 있으면 키보드 바로 위에 띄운다(로그인 화면 등). 아니면 떠 있는 탭 바 위.
  const bottom = keyboard > 0 ? keyboard + Spacing.three : tabBarBottom + TabBarHeight + Spacing.three;
  // One step lighter than the dark background, like Toss; charcoal on the light background.
  const pill = scheme === 'dark' ? Colors.dark.backgroundSelected : '#33353B';

  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom }]}>
      {toast && (
        <Animated.View
          key={toast.id}
          // Up from below, back down on the way out. "Reduce motion" turns both into a plain cut.
          entering={FadeInDown.duration(260).reduceMotion(ReduceMotion.System)}
          exiting={FadeOutDown.duration(200).reduceMotion(ReduceMotion.System)}>
          <Pressable
            accessibilityRole="alert"
            accessibilityLabel={`${KINDS[toast.kind].label}, ${toast.text}`}
            accessibilityHint="누르면 닫혀요"
            onPress={dismiss}
            style={[styles.pill, { backgroundColor: pill }]}>
            <SymbolView
              name={{ ios: KINDS[toast.kind].ios, android: KINDS[toast.kind].android, web: KINDS[toast.kind].android }}
              size={26}
              tintColor={KINDS[toast.kind].color}
            />
            <Text style={styles.text}>{toast.text}</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 22,
    borderRadius: 28,
    boxShadow: Shadow.toast,
  },
  // White on either pill color: about 10:1 on the dark one, 12:1 on charcoal.
  text: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: FontSize.label,
    fontWeight: 700,
    lineHeight: 25,
  },
});
