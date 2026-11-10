import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { FontSize, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useSpeech } from '@/hooks/use-speech';
import type { CaptureMode } from '@/types/capture';

const TITLE = '작품을 찾지 못했어요';
const GUIDE = '작품이나 QR 코드를 화면\n중앙에 위치시켜 주세요.';

/** 촬영 실패 안내(1-3). 카메라와 동일하게 탭 바 없는 다크 화면으로 표시한다. */
export default function ArtworkNotFoundScreen() {
  const palette = getPalette('dark', false);
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode: CaptureMode = rawMode === 'qr' ? 'qr' : 'artwork';
  useSpeech(`${TITLE}. ${GUIDE.replace('\n', ' ')}`);

  const openList = () => {
    router.dismissAll();
    router.navigate('/');
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.header, { color: palette.text }]}>
          작품 찾기
        </Text>

        <View style={styles.message}>
          <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.searchEmblem, { borderColor: palette.highlight }]}>
              {/* 한 좌표계에서 그려 OS별 심볼 모양에 따라 X 위치가 달라지지 않게 한다. */}
              <View style={styles.searchIcon}>
                <View style={[styles.searchHandle, { backgroundColor: palette.text }]} />
                <View style={[styles.searchLens, { borderColor: palette.text }]}>
                  <View style={styles.searchCross}>
                    <View style={[styles.crossStroke, styles.crossForward, { backgroundColor: palette.text }]} />
                    <View style={[styles.crossStroke, styles.crossBackward, { backgroundColor: palette.text }]} />
                  </View>
                </View>
              </View>
            </View>
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
            {TITLE}
          </Text>
          <Text style={[styles.guide, { color: palette.textSecondary }]}>{GUIDE}</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.buttonRow}>
            <BigButton
              label="다시 촬영하기"
              palette={palette}
              accessibilityHint="카메라를 열어 작품이나 QR 코드를 다시 찾아요"
              onPress={() => router.replace({ pathname: '/capture', params: { mode } })}
            />
          </View>
          <View style={styles.buttonRow}>
            <BigButton
              label="목록에서 고르기"
              palette={palette}
              selected={false}
              accessibilityHint="홈의 작품 목록으로 이동해요"
              onPress={openList}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
  },
  header: { fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  message: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.six,
    paddingBottom: Spacing.six,
  },
  searchEmblem: {
    width: 144,
    height: 144,
    borderRadius: 72,
    borderWidth: 3,
    transform: [{ translateY: -Spacing.three }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: { width: 56, height: 56 },
  searchLens: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHandle: {
    position: 'absolute',
    left: 31,
    top: 39,
    width: 22,
    height: 3,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  searchCross: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  crossStroke: { position: 'absolute', width: 14, height: 2, borderRadius: 1 },
  crossForward: { transform: [{ rotate: '45deg' }] },
  crossBackward: { transform: [{ rotate: '-45deg' }] },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 700,
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  guide: {
    fontSize: FontSize.body,
    lineHeight: 30,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  actions: { gap: 12, paddingBottom: Spacing.four },
  buttonRow: { flexDirection: 'row' },
});
