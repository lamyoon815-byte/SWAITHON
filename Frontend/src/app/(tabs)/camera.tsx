// 카메라 탭: 작품 찾는 방법 고르기 → 1-2 QR 스캔 / 4 작품 촬영 (`/capture?mode=`)
/**
 * 촬영 전에 무엇을 어떻게 비추는지 먼저 알려 주고, 큰 버튼 두 개로 방법을 고른다.
 * 카메라 권한은 버튼을 누를 때 묻는다 (탭을 열자마자 팝업이 뜨지 않게).
 */

import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { showToast } from '@/components/common/toast';
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import type { CaptureMode } from '@/types/capture';

const METHODS: { mode: CaptureMode; label: string; ios: SFSymbol; material: AndroidSymbol }[] = [
  { mode: 'qr', label: 'QR 코드', ios: 'qrcode', material: 'qr_code' },
  { mode: 'artwork', label: '작품 사진', ios: 'photo.artframe', material: 'image' },
];

const TIPS = [
  '작품 옆 안내판에 QR 코드가 있으면 QR로 찾는 게 가장 빨라요.',
  'QR 코드가 없으면 작품을 정면에서 찍어 주세요. 찍은 사진으로 작품을 찾아요.',
  '찾은 작품의 미술관이 현재 미술관으로 바뀌어요.',
];

export default function CameraScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const [permission, requestPermission] = useCameraPermissions();

  const open = async (mode: CaptureMode) => {
    if (!permission?.granted) {
      if (permission && !permission.canAskAgain) {
        showToast('설정에서 카메라를 허용해 주세요');
        Linking.openSettings();
        return;
      }
      const res = await requestPermission();
      if (!res.granted) {
        showToast('카메라 권한이 있어야 작품을 찾을 수 있어요');
        return;
      }
    }
    router.push({ pathname: '/capture', params: { mode } });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
          {'어떻게 작품을\n찾을까요?'}
        </Text>

        <View style={styles.tiles}>
          {METHODS.map((m) => (
            <Pressable
              key={m.mode}
              accessibilityRole="button"
              accessibilityLabel={m.mode === 'qr' ? 'QR 코드 스캔' : '작품 촬영'}
              onPress={() => open(m.mode)}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: palette.fill, opacity: pressed ? 0.8 : 1 },
              ]}>
              <SymbolView
                name={{ ios: m.ios, android: m.material, web: m.material }}
                size={56}
                tintColor={palette.text}
              />
              <Text style={[styles.tileLabel, { color: palette.text }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.tips, { backgroundColor: palette.surface, borderColor: palette.fill }]}>
          {TIPS.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={[styles.tipBullet, { color: palette.textSecondary }]}>•</Text>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.tipText, { color: palette.textSecondary }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <ActionButton label="QR 코드 스캔" palette={palette} secondary onPress={() => open('qr')} />
          <ActionButton label="작품 촬영" palette={palette} onPress={() => open('artwork')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type ActionProps = { label: string; palette: Palette; secondary?: boolean; onPress: () => void };

function ActionButton({ label, palette, secondary, onPress }: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: secondary ? palette.fill : palette.accent, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Text style={[styles.actionText, { color: secondary ? palette.text : palette.accentText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
  },
  heading: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 38,
  },
  tiles: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    flex: 1,
    aspectRatio: 1.15,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  tileLabel: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  tips: {
    gap: 12,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  tipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tipBullet: {
    fontSize: FontSize.label,
    lineHeight: 27,
  },
  tipText: {
    flex: 1,
    fontSize: FontSize.label,
    fontWeight: 500,
    lineHeight: 27,
  },
  actions: {
    marginTop: 'auto',
    gap: 12,
  },
  action: {
    height: MinTouchTarget + 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: FontSize.button,
    fontWeight: 800,
  },
});
