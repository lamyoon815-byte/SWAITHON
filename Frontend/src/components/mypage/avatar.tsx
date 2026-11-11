import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/common/text';
import type { Palette } from '@/constants/a11y';

type Props = {
  /** 사진 경로. 없으면 닉네임 첫 글자, 닉네임도 없으면(로그아웃) 사람 아이콘 */
  uri: string | null;
  name?: string;
  size?: number;
  palette: Palette;
};

/** 동그란 프로필 사진. 장식이라 스크린리더는 읽지 않는다(이름은 옆 글자가 읽힌다). */
export function Avatar({ uri, name, size = 72, palette }: Props) {
  const initial = name?.trim().charAt(0).toUpperCase();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: initial ? palette.highlight : palette.fill, borderColor: palette.outline }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : initial ? (
        <Text style={{ color: palette.highlightText, fontSize: size * 0.42, fontWeight: 800 }}>{initial}</Text>
      ) : (
        <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={size * 0.5} tintColor={palette.textSecondary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5 },
});
