// 카메라 탭: 작품 찾는 두 방법(QR · 작품 사진)을 안내하고, 카메라 하나(`/capture`)로 둘 다 찾는다.
/**
 * 방법 카드는 설명일 뿐 버튼이 아니다(테두리·› 없음). 누르는 건 아래 '카메라 켜기' 하나뿐이다.
 * 카메라에서는 QR이 보이면 바로 찾고, QR이 없으면 촬영 버튼으로 작품을 찍는다.
 * 카메라 권한은 버튼을 누를 때 묻는다 (탭을 열자마자 팝업이 뜨지 않게).
 */

import { Image } from 'expo-image';
import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';

const METHODS: {
  key: string;
  label: string;
  desc: string;
  ios: SFSymbol;
  material: AndroidSymbol;
}[] = [
  {
    key: 'qr',
    label: 'QR 코드',
    desc: '안내판의 QR을 비추기만 하면 바로 찾아요',
    ios: 'qrcode.viewfinder',
    material: 'qr_code_scanner',
  },
  {
    key: 'artwork',
    label: '작품 사진',
    desc: 'QR이 없으면 작품 전체를 정면에서 찍어요',
    ios: 'photo.artframe',
    material: 'image',
  },
];

const TIPS = [
  '목록에 없는 작품도 AI가 사진을 보고 설명해 줘요',
  '작품 전체가 보이게 정면에서 찍어 주세요',
  '찾은 작품의 미술관이 현재 미술관으로 바뀌어요',
];

export default function CameraScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const [permission, requestPermission] = useCameraPermissions();

  const open = async () => {
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
    router.push('/capture');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
            {'카메라로\n작품을 찾아요'}
          </Text>
          <Image source={require('@/assets/images/mascot/photography.png')} contentFit="contain"
            style={styles.mascot} accessible={false} />
        </View>

        <View style={styles.methods}>
          {METHODS.map((m) => (
            <View key={m.key} accessible accessibilityLabel={`${m.label}, ${m.desc}`} style={[styles.method, { backgroundColor: palette.surface }]}>
              <View style={[styles.methodIcon, { backgroundColor: palette.fill }]}>
                <SymbolView
                  name={{ ios: m.ios, android: m.material, web: m.material }}
                  size={30}
                  weight="medium"
                  tintColor={palette.text}
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
            </View>
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

        <View style={styles.buttonRow}>
          <BigButton label="카메라 켜기" accessibilityHint="QR 코드를 비추거나 작품을 찍어 찾아요" palette={palette} onPress={() => { void open(); }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 카멜레온 발이 QR 코드 상자 윗부분에 걸치는 깊이 */
const MASCOT_PERCH = 22;
/** 카멜레온만 위로 올리는 정도. 발바닥은 상자 안, 발등은 상자 윗선에 맞는다 */
const MASCOT_LIFT = 12;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: Spacing.four,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
  },
  // 카멜레온이 QR 코드 상자 위에 걸터앉도록 헤더를 상자 쪽으로 MASCOT_PERCH만큼 겹친다(아래 내용 전체가 그만큼 올라간다).
  // zIndex로 카멜레온을 상자 앞에 그린다.
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, zIndex: 2, elevation: 2, marginBottom: -(Spacing.four + MASCOT_PERCH) },
  // 그림 비율(1326×1187)에 맞춰 위아래 빈칸 없이 발이 상자 경계에 닿게 한다.
  // 카멜레온만 살짝 올려 발등이 QR 상자 윗선에 맞게 한다(상자와 아래 내용 위치는 그대로).
  mascot: { width: 124, height: 111, marginBottom: MASCOT_LIFT },
  heading: {
    flex: 1,
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 38,
    // 제목은 상자에 가리지 않게 겹치는 만큼 위로 띄운다.
    marginBottom: MASCOT_PERCH + Spacing.three,
  },
  methods: {
    gap: 12,
  },
  // 설명 카드: 테두리 없이 옅은 면만 둬서 버튼처럼 보이지 않게 한다.
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: 24,
  },
  buttonRow: {
    flexDirection: 'row',
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
    fontSize: 20,
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
