// 카메라 탭: 작품 찾는 방법 고르기 → 1-2 QR 스캔 / 4 작품 촬영 (`/capture?mode=`)
/**
 * 촬영 전에 무엇을 어떻게 비추는지 먼저 알려 주고, 큰 버튼 두 개로 방법을 고른다.
 * 버튼은 한 벌만 둔다: 가로로 긴 카드(아이콘 · 이름 · 한 줄 설명 · ›)라서 눌러지는 것처럼 보인다.
 * 카메라 권한은 버튼을 누를 때 묻는다 (탭을 열자마자 팝업이 뜨지 않게).
 */

import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { showToast } from '@/components/common/toast';
import { FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import type { CaptureMode } from '@/types/capture';

const METHODS: {
  mode: CaptureMode;
  label: string;
  desc: string;
  ios: SFSymbol;
  material: AndroidSymbol;
}[] = [
  {
    mode: 'qr',
    label: 'QR 코드',
    desc: '안내판의 QR을 비추면 바로 찾아요',
    ios: 'qrcode.viewfinder',
    material: 'qr_code_scanner',
  },
  {
    mode: 'artwork',
    label: '작품 사진',
    desc: 'QR이 없으면 작품을 정면에서 찍어요',
    ios: 'photo.artframe',
    material: 'image',
  },
];

const TIPS = [
  'QR 코드가 있으면 QR로 찾는 게 가장 빨라요.',
  '찾은 작품의 미술관이 현재 미술관으로 바뀌어요.',
];

export default function CameraScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const [permission, requestPermission] = useCameraPermissions();

  const open = async (mode: CaptureMode) => {
    if (!permission?.granted) {
      if (permission && !permission.canAskAgain) {
        showToast('설정에서 카메라를 허용해 주세요', 'warning');
        Linking.openSettings();
        return;
      }
      const res = await requestPermission();
      if (!res.granted) {
        showToast('카메라 권한이 있어야 작품을 찾을 수 있어요', 'warning');
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

        <View style={styles.methods}>
          {METHODS.map((m) => (
            <Pressable
              key={m.mode}
              accessibilityRole="button"
              accessibilityLabel={m.mode === 'qr' ? 'QR 코드 스캔' : '작품 촬영'}
              accessibilityHint={m.desc}
              onPress={() => open(m.mode)}
              style={({ pressed }) => [
                styles.method,
                // Both ways get the main color outline, so they read as the same kind of button.
                {
                  backgroundColor: pressed ? palette.fill : palette.surface,
                  borderColor: palette.accent,
                },
              ]}>
              <View style={[styles.methodIcon, { backgroundColor: palette.highlight }]}>
                <SymbolView
                  name={{ ios: m.ios, android: m.material, web: m.material }}
                  size={30}
                  weight="medium"
                  tintColor={palette.highlightText}
                />
              </View>
              <View style={styles.methodTexts}>
                <Text style={[styles.methodLabel, { color: palette.text }]}>{m.label}</Text>
                <Text
                  lineBreakStrategyIOS="hangul-word"
                  style={[styles.methodDesc, { color: palette.textSecondary }]}>
                  {m.desc}
                </Text>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={20}
                weight="semibold"
                tintColor={palette.textSecondary}
              />
            </Pressable>
          ))}
        </View>

        <View style={[styles.tips, { backgroundColor: palette.fill, borderColor: palette.fill }]}>
          {TIPS.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={[styles.tipBullet, { color: palette.textSecondary }]}>•</Text>
              <Text
                lineBreakStrategyIOS="hangul-word"
                style={[styles.tipText, { color: palette.textSecondary }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: Spacing.four,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.four,
  },
  heading: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 38,
  },
  methods: {
    gap: 12,
  },
  // A minimum, not a fixed height: two lines of text grow with the system text size.
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 104,
    paddingVertical: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: 18,
    borderWidth: 2,
    borderRadius: 24,
  },
  methodIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTexts: {
    flex: 1,
    gap: 4,
  },
  methodLabel: {
    fontSize: 22,
    fontWeight: 800,
  },
  methodDesc: {
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 23,
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
});
