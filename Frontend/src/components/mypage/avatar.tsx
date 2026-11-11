import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { Palette } from '@/constants/a11y';

type Props = {
  /** 사진 경로. 없으면 그림 그리는 MoMi 카멜레온을 기본 이미지로 표시한다. */
  uri: string | null;
  name?: string;
  size?: number;
  palette: Palette;
};

/** 동그란 프로필 사진. 장식이라 스크린리더는 읽지 않는다(이름은 옆 글자가 읽힌다). */
export function Avatar({ uri, size = 72, palette }: Props) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.fill, borderColor: palette.outline }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <Image source={require('@/assets/images/mascot/painting.png')} style={styles.defaultImage} contentFit="contain" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  defaultImage: { width: '90%', height: '90%' },
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5 },
});
