/**
 * 가운데 확인 창 (로그아웃, 변경사항 폐기처럼 되돌리기 어려운 동작 전에 묻는다).
 * 제목 · 설명 · [취소][확인] 한 줄. 확인은 밝게 채우고 취소는 어두운 회색이라, 색이 아니라 밝기로도 구분된다.
 * 뜰 때 살짝 작게 시작해 조금 커졌다가 제자리로(톡 튀어나오는 느낌). "동작 줄이기"면 그냥 나타난다.
 * 바깥이나 안드로이드 뒤로가기는 취소와 같다.
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, ZoomIn } from 'react-native-reanimated';

import { PressableScale } from '@/components/common/pressable-scale';
import { Text } from '@/components/common/text';
import { ButtonRadius, FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  palette: Palette;
  /** 처리 중이면 두 버튼과 바깥 누르기를 막는다 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = '취소', palette, busy, onConfirm, onCancel }: Props) {
  const cancel = () => { if (!busy) onCancel(); };
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={cancel}>
      <Animated.View entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)} style={[styles.scrim, { backgroundColor: Scrim }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${title} 창 닫기`} onPress={cancel} style={StyleSheet.absoluteFill} />
        <Animated.View
          accessibilityViewIsModal
          entering={ZoomIn.springify().damping(14).stiffness(260).mass(0.7).reduceMotion(ReduceMotion.System)}
          style={[styles.dialog, { backgroundColor: palette.surface }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{title}</Text>
          {!!message && <Text lineBreakStrategyIOS="hangul-word" style={[styles.message, { color: palette.text }]}>{message}</Text>}
          <View style={styles.actions}>
            <PressableScale accessibilityRole="button" accessibilityLabel={cancelLabel} accessibilityState={{ disabled: busy }} disabled={busy} onPress={cancel}
              style={[styles.button, { backgroundColor: palette.fill, opacity: busy ? 0.5 : 1 }]}>
              <Text style={[styles.buttonText, { color: palette.text }]}>{cancelLabel}</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onConfirm}
              style={[styles.button, { backgroundColor: palette.text, opacity: busy ? 0.5 : 1 }]}>
              <Text style={[styles.buttonText, { color: palette.background }]}>{confirmLabel}</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: ScreenPadding },
  dialog: { width: '100%', maxWidth: MaxContentWidth - 40, alignSelf: 'center', paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.four, borderRadius: 24, gap: Spacing.two },
  title: { fontSize: FontSize.heading, fontWeight: 800 },
  message: { fontSize: FontSize.body, lineHeight: 30 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  button: { flex: 1, minHeight: MinTouchTarget, borderRadius: ButtonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  buttonText: { fontSize: FontSize.label, fontWeight: 800, textAlign: 'center' },
});
