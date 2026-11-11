/**
 * 재생 속도 고르기 (유튜브처럼). 아래에서 시트가 올라오고, 속도 목록 중 지금 값에 ✓가 붙는다.
 * 하나를 누르면 바로 바뀌고 닫힌다. 바깥(어두운 곳)이나 "닫기"를 눌러도 닫힌다.
 * ✓ 자리는 항상 비워 두어서 고를 때 글자가 움직이지 않는다. "동작 줄이기"면 미끄러지지 않고 바로 뜬다.
 */

import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ButtonHeight, ButtonRadius, FontSize, type Palette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';

/** 시각 프로필 `speech_rate` 범위(0.75~1.5) 안에서만 */
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5];

/** 1 → "보통", 1.25 → "1.25배" (유튜브 표기) */
export function formatRate(rate: number) {
  return rate === 1 ? '보통' : `${rate}배`;
}

type Props = {
  visible: boolean;
  rate: number;
  palette: Palette;
  onSelect: (rate: number) => void;
  onClose: () => void;
};

export function SpeedSheet({ visible, rate, palette, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="재생 속도 닫기"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <Animated.View
          accessibilityViewIsModal
          entering={SlideInDown.duration(240).reduceMotion(ReduceMotion.System)}
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              borderColor: palette.outline,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: palette.outline }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
            재생 속도
          </Text>

          <View accessibilityRole="radiogroup" accessibilityLabel="재생 속도">
            {SPEECH_RATES.map((r) => {
              const on = r === rate;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityLabel={r === 1 ? '보통 속도' : `${r}배 속도`}
                  accessibilityState={{ checked: on }}
                  onPress={() => onSelect(r)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: palette.highlight },
                  ]}>
                  {({ pressed }) => {
                    const color = pressed ? palette.highlightText : palette.text;
                    return (
                      <>
                        <SymbolView
                          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                          size={22}
                          weight="bold"
                          tintColor={color}
                          style={{ opacity: on ? 1 : 0 }}
                        />
                        <Text style={[styles.rowText, { color, fontWeight: on ? 800 : 600 }]}>
                          {formatRate(r)}
                        </Text>
                      </>
                    );
                  }}
                </Pressable>
              );
            })}
          </View>

          <PressableScale
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: pressed ? palette.highlight : palette.fill },
            ]}>
            {({ pressed }) => (
              <Text
                style={[
                  styles.closeText,
                  { color: pressed ? palette.highlightText : palette.text },
                ]}>
                닫기
              </Text>
            )}
          </PressableScale>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    gap: Spacing.two,
    paddingHorizontal: ScreenPadding,
    paddingTop: 10,
    borderTopWidth: 1.5,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: FontSize.body,
    fontWeight: 800,
    paddingHorizontal: 4,
    paddingBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: ButtonHeight,
    paddingHorizontal: 14,
    borderRadius: ButtonRadius,
  },
  rowText: {
    fontSize: FontSize.label,
  },
  close: {
    marginTop: Spacing.two,
    minHeight: ButtonHeight,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 17,
    fontWeight: 800,
  },
});
