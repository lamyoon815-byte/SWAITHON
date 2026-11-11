import type { ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenPadding, Spacing } from '@/constants/theme';

const FadeHeight = 40;

type Props = {
  children: ReactNode;
  /** 페이지 배경색(#RRGGBB). 페이드가 이 색으로 녹아든다. */
  background: string;
  /** 바 높이(페이드 제외)를 알려준다. 스크롤 영역 아래 여백으로 쓴다. */
  onHeight?: (height: number) => void;
};

/**
 * 화면 아래에 고정되는 버튼 영역. 위쪽에 짧은 페이드가 있어 스크롤되는 내용이 버튼 뒤로 자연스럽게 사라진다.
 * 부모는 `flex: 1` 컨테이너여야 하고, 스크롤 영역에 `onHeight`로 받은 만큼 paddingBottom을 준다.
 */
export function BottomActionBar({ children, background, onHeight }: Props) {
  const insets = useSafeAreaInsets();
  const onLayout = (event: LayoutChangeEvent) => onHeight?.(event.nativeEvent.layout.height);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View
        pointerEvents="none"
        style={[styles.fade, { experimental_backgroundImage: `linear-gradient(180deg, ${background}00 0%, ${background}99 55%, ${background}E6 100%)` }]}
      />
      <View onLayout={onLayout} style={[styles.bar, { experimental_backgroundImage: `linear-gradient(180deg, ${background}E6 0%, ${background} 40%)`, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
        <View style={styles.inner}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { height: FadeHeight },
  bar: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.one },
  inner: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 12 },
});
