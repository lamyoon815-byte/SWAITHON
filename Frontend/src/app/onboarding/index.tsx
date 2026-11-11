import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { Text } from '@/components/common/text';
import { showToast } from '@/components/common/toast';
import { OnboardingIllustration } from '@/components/onboarding/illustration';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { ONBOARDING_SLIDES } from '@/constants/onboarding';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';

export default function OnboardingScreen() {
  const palette = getPalette('dark', false);
  const { loaded, finishOnboarding } = useSettings();
  const window = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(window.width);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<(typeof ONBOARDING_SLIDES)[number]>>(null);
  const reduceMotion = useReducedMotion();
  const announced = useRef(false);
  const last = page === ONBOARDING_SLIDES.length - 1;

  useEffect(() => {
    if (!announced.current) { announced.current = true; return; }
    AccessibilityInfo.announceForAccessibility(`${page + 1} / ${ONBOARDING_SLIDES.length}. ${ONBOARDING_SLIDES[page].title.replace('\n', ' ')}`);
  }, [page]);

  const goTo = (next: number) => {
    if (busy || next < 0 || next >= ONBOARDING_SLIDES.length) return;
    setPage(next);
    list.current?.scrollToOffset({ offset: next * pageWidth, animated: !reduceMotion });
  };
  const finish = async (destination: 'home' | 'correction') => {
    if (busy || !loaded) return;
    setBusy(true);
    try {
      if (destination === 'correction') {
        router.push('/onboarding/calibration');
        setBusy(false);
      } else {
        await finishOnboarding();
        router.replace('/');
      }
    } catch {
      setBusy(false);
      showToast('설정을 저장하지 못했어요. 다시 시도해 주세요', 'error');
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerSide}>{page > 0 && <BackButton label="이전 소개" palette={palette} onPress={() => goTo(page - 1)} />}</View>
        <Text style={[styles.brand, { color: palette.text }]}>MoMi</Text>
        <View style={styles.headerSide}>
          {!last && <Pressable accessibilityRole="button" accessibilityLabel="소개 건너뛰기" disabled={busy || !loaded} onPress={() => { void finish('home'); }} style={({ pressed }) => [styles.skip, { opacity: busy ? 0.4 : pressed ? 0.7 : 1 }]}>
            <View style={[styles.skipPill, { borderColor: palette.outline }]}>
              <Text style={[styles.skipLabel, { color: palette.textSecondary }]}>건너뛰기</Text>
            </View>
          </Pressable>}
        </View>
      </View>

      <View style={styles.pager} onLayout={(event) => { const width = event.nativeEvent.layout.width; if (width > 0) setPageWidth(width); }}>
        <FlatList
          key={Math.round(pageWidth)}
          ref={list}
          data={ONBOARDING_SLIDES}
          horizontal
          pagingEnabled
          scrollEnabled={!busy}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={page}
          keyExtractor={(item) => item.artwork}
          extraData={page}
          getItemLayout={(_data, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
          onMomentumScrollEnd={(event) => setPage(Math.max(0, Math.min(ONBOARDING_SLIDES.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth))))}
          renderItem={({ item, index }) => (
            <ScrollView style={{ width: pageWidth }} contentContainerStyle={styles.slide} accessibilityElementsHidden={index !== page} importantForAccessibility={index === page ? 'auto' : 'no-hide-descendants'}>
              <View style={styles.slideContent}>
                <OnboardingIllustration kind={item.artwork} palette={palette} />
                <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.heading, { color: palette.text }]}>{item.title}</Text>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: palette.textSecondary }]}>{item.description}</Text>
              </View>
            </ScrollView>
          )}
        />
      </View>

      <View style={styles.footer}>
        {!last && <View style={styles.pagination} accessibilityRole="progressbar" accessibilityLabel="소개 진행" accessibilityValue={{ min: 1, max: 4, now: page + 1, text: `${page + 1} / 4` }}>
          <View style={styles.dots}>{ONBOARDING_SLIDES.map((item, index) => <View key={item.artwork} style={[styles.dot, { backgroundColor: index === page ? palette.highlight : palette.outline }]} />)}</View>
        </View>}
        <View style={styles.buttonRow}><BigButton label={busy ? '저장 중…' : last ? '내 눈에 맞추기' : '다음'} palette={palette} disabled={busy || !loaded} onPress={() => { if (last) void finish('correction'); else goTo(page + 1); }} /></View>
        {last && (
          <View style={styles.buttonRow}><BigButton label="먼저 둘러보기" selected={false} palette={palette} disabled={busy || !loaded} onPress={() => { void finish('home'); }} /></View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: Spacing.two },
  headerSide: { width: 88, minHeight: MinTouchTarget, justifyContent: 'center' },
  brand: { flex: 1, fontSize: FontSize.label, fontWeight: 800, textAlign: 'center' },
  skip: { minHeight: MinTouchTarget, minWidth: MinTouchTarget, justifyContent: 'center', alignItems: 'center' },
  skipPill: { maxWidth: '100%', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  skipLabel: { fontSize: FontSize.label, textAlign: 'center', fontWeight: 600 },
  pager: { flex: 1 },
  slide: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.four },
  slideContent: { width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', gap: Spacing.four },
  heading: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 700, textAlign: 'center' },
  description: { fontSize: FontSize.body, lineHeight: 30, textAlign: 'center' },
  footer: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingBottom: Spacing.three, gap: 12 },
  pagination: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { flexDirection: 'row' },
});
