/**
 * 아래에서 올라오는 시트. 지금 화면을 벗어나지 않고 하나를 고르거나 짧게 정할 때 쓴다.
 * 바깥(어두운 곳)을 누르거나 안드로이드 뒤로가기로 닫히고, 내용 안에는 닫기/저장 버튼을 꼭 같이 둔다
 * (손잡이는 작아서 저시력·스크린리더 사용자가 쓰기 어렵다). "동작 줄이기"면 미끄러지지 않고 바로 뜬다.
 * 되돌릴 수 없는 확인(폐기·삭제)은 시트 말고 가운데 다이얼로그를 쓴다.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/common/text';
import { FontSize, type Palette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  title: string;
  palette: Palette;
  onClose: () => void;
  /** false면 바깥 누르기·뒤로가기로 닫히지 않는다 (저장 중일 때) */
  dismissible?: boolean;
  children: ReactNode;
};

export function BottomSheet({ visible, title, palette, onClose, dismissible = true, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const close = () => { if (dismissible) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} 닫기`}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: Scrim }]}
        />
        <Animated.View
          accessibilityViewIsModal
          entering={SlideInDown.duration(240).reduceMotion(ReduceMotion.System)}
          style={[styles.sheet, { maxHeight: height * 0.85, backgroundColor: palette.surface, borderColor: palette.outline }]}>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.handle, { backgroundColor: palette.outline }]} />
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{title}</Text>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3 },
  content: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, gap: 12 },
  title: { fontSize: FontSize.heading, fontWeight: 700, marginBottom: Spacing.two },
});
