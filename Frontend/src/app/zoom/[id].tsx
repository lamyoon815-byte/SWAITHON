// 작품 크게 보기 (디자인 "저시력 미술관 앱"의 작품 확대). 작품 상세의 이미지나 "확대"에서 들어온다
/**
 * 탭 바 없는 검은 전체 화면. 두 손가락으로 확대·이동, 두 번 눌러 확대, 아래 버튼으로도 확대한다
 * (스크린리더를 켜면 핀치가 막혀서 버튼이 꼭 필요하다). 보정본/원본은 상세 화면에서 고른 대로 보여 준다.
 * 화면은 테마와 상관없이 항상 어둡게 둔다 (작품에 눈이 가도록).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { ButtonHeight, ButtonRadius, FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { getArtwork } from '@/lib/api';
import { PREVIEW_PROFILE } from '@/types/profile';

// TODO(A): 상세 화면과 같이 로그인 후 받은 시각 프로필로 바꾼다.
const profile = PREVIEW_PROFILE;

export default function ZoomScreen() {
  const palette = getPalette('dark', false);
  const { id, original, strength } = useLocalSearchParams<{
    id: string;
    original?: string;
    /** 상세 화면의 보정 강도(0~1). 없으면 프로필 값 */
    strength?: string;
  }>();
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const showOriginal = original === '1';

  return (
    // A full-screen modal is its own native window, so pinch needs its own gesture root here.
    <GestureHandlerRootView style={styles.screen}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.title, { color: palette.text }]}>
            {artwork?.title ?? ''}
          </Text>
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            {showOriginal ? '원본 · ' : '보정본 · '}두 손가락으로 벌리거나 아래 버튼으로 확대해요
          </Text>
        </View>

        {artwork ? (
          <CorrectionCanvas
            source={artwork.image_url}
            accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
            correction={{ ...profile, strength: strength ? Number(strength) : profile.strength }}
            original={showOriginal}
            zoomable
            palette={palette}
            containerStyle={styles.canvasArea}
            style={styles.canvas}
          />
        ) : (
          <View style={styles.canvasArea}>
            {!!error && (
              <Text style={[styles.message, { color: palette.text }]}>
                작품 이미지를 불러오지 못했어요
              </Text>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닫기"
            accessibilityHint="작품 상세로 돌아가요"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Text style={[styles.closeText, { color: palette.accentText }]}>닫기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  top: {
    gap: 4,
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  title: {
    fontSize: FontSize.body,
    fontWeight: 800,
    textAlign: 'center',
  },
  hint: {
    fontSize: 16,
    fontWeight: 600,
    textAlign: 'center',
  },
  canvasArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  canvas: {
    flex: 1,
    height: undefined,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: '#000000',
  },
  message: {
    fontSize: FontSize.label,
    fontWeight: 600,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  close: {
    minHeight: ButtonHeight,
    paddingHorizontal: 36,
    paddingVertical: 10,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
});
