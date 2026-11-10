/**
 * 웹 대체 버전. 웹에는 Skia 엔진(CanvasKit)을 싣지 않아서 보정 없이 그림만 보여 준다.
 * 실제 보정 · 확대는 휴대폰(Expo Go)에서 확인한다. Props는 네이티브 버전과 같다.
 */

import type { DataSourceParam } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/common/text';

import { FontSize, type Palette } from '@/constants/a11y';
import type { CorrectionValues } from '@/types/profile';

type Props = {
  source: DataSourceParam;
  accessibilityLabel: string;
  correction: CorrectionValues;
  original?: boolean;
  zoomable?: boolean;
  palette: Palette;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

export function CorrectionCanvas({
  source,
  accessibilityLabel,
  original = false,
  palette,
  style,
  containerStyle,
}: Props) {
  const imageSource = typeof source === 'string' ? { uri: source } : (source as number | undefined);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <View
        style={[styles.canvasBox, { backgroundColor: palette.surface, borderColor: palette.border }, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${accessibilityLabel}${original ? ', 원본' : ', 보정본'}`}>
        {source ? (
          <Image source={imageSource} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : (
          <View style={styles.center}>
            <Text style={[styles.note, { color: palette.textSecondary }]}>작품 이미지 준비 중</Text>
          </View>
        )}
      </View>
      <Text style={[styles.webNote, { color: palette.textSecondary }]}>
        웹 미리보기는 보정 없이 보여요. 보정과 확대는 휴대폰에서 확인해 주세요.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  canvasBox: {
    height: 320,
    borderWidth: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontSize: FontSize.label,
    fontWeight: 600,
  },
  webNote: {
    fontSize: 16,
    fontWeight: 600,
  },
});
