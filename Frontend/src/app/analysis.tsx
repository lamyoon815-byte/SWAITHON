/**
 * 등록되지 않은 작품의 AI 해설. 촬영 화면에서 서버가 "미등록 작품(analyze)"이라고 하면 사진을 `/analyze`로 보내고 여기로 온다.
 * 위에서부터 찍은 사진 → "AI 해설 · 미검수" 표시 → 사실 · 해석 문장(지금 읽는 문장은 머스타드) → 아래 고정 '해설 듣기'.
 * 문장을 누르면 거기서부터 읽는다. 결과는 앱 메모리에만 있어서 앱을 다시 켜면 다시 찍어야 한다.
 */

import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
import { PressableScale } from '@/components/common/pressable-scale';
import { Text } from '@/components/common/text';
import { TextButton } from '@/components/common/text-button';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useNarrationPlayer } from '@/hooks/use-narration-player';
import { useProfile } from '@/hooks/use-profile';
import { getAnalysis } from '@/lib/analysis-store';

export default function AnalysisScreen() {
  const palette = getPalette('dark', false);
  const { profile } = useProfile();
  const { height } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entry = getAnalysis(id);
  const [barHeight, setBarHeight] = useState(0);
  const sentences = entry?.result.segments.map((segment) => ({
    kind: segment.type === 'fact' ? '사실' : '해석', text: segment.text,
  })) ?? [];
  const player = useNarrationPlayer(sentences.map((s) => s.text), profile.speech_rate, false);
  const retake = () => router.replace('/capture');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <BackButton label="닫기" palette={palette} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>AI 작품 해설</Text>
        <View style={styles.headerSpace} />
      </View>

      {!entry ? (
        <View style={styles.missing}>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.body, { color: palette.text }]}>해설이 만료됐어요. 작품을 다시 찍어 주세요.</Text>
          <View style={styles.row}><BigButton label="다시 촬영하기" palette={palette} onPress={retake} /></View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barHeight + 40 }]}>
            <Image source={{ uri: entry.photoUri }} contentFit="contain" accessibilityLabel="찍은 작품 사진"
              style={[styles.photo, { height: Math.max(220, height * 0.36), backgroundColor: palette.surface }]} />

            <View accessible accessibilityLabel={`AI가 만든 해설이에요. ${entry.result.warning}`}
              style={[styles.notice, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
              <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={20} tintColor={palette.highlight} />
              <View style={styles.noticeTexts}>
                <Text style={[styles.noticeTitle, { color: palette.text }]}>등록되지 않은 작품이에요</Text>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.noticeText, { color: palette.textSecondary }]}>
                  {entry.result.warning || 'AI가 사진을 보고 만든 해설이에요. 전문가가 검수하지 않았어요.'}
                </Text>
              </View>
            </View>

            {sentences.map((s, i) => {
              const now = i === player.index && (player.playing || player.preparing || player.index > 0);
              return (
                <PressableScale key={i} accessibilityRole="button" accessibilityLabel={`${s.kind}. ${s.text}`} accessibilityHint="이 문장부터 읽어요"
                  accessibilityState={{ selected: now }} onPress={() => player.playFrom(i)}
                  pressedScale={0.98} background={now ? palette.highlight : palette.surface} pressedBackground={now ? palette.highlight : palette.fill}
                  style={[styles.sentence, { borderColor: now ? palette.highlight : palette.outline }]}>
                  <Text style={[styles.tag, { color: now ? palette.highlightText : palette.textSecondary, borderColor: now ? palette.highlightText : palette.outline }]}>{s.kind}</Text>
                  <Text lineBreakStrategyIOS="hangul-word" style={[styles.sentenceText, { color: now ? palette.highlightText : palette.text }]}>{s.text}</Text>
                </PressableScale>
              );
            })}
            {!!player.error && <Text accessibilityRole="alert" style={[styles.body, { color: palette.text }]}>{player.error}</Text>}
            <TextButton label="다시 촬영하기" palette={palette} onPress={retake} />
          </ScrollView>

          <BottomActionBar background={palette.background} onHeight={setBarHeight}>
            <View style={styles.row}>
              <BigButton
                label={player.preparing ? '음성 준비 중…' : player.playing ? '해설 멈추기' : player.index > 0 ? '이어서 듣기' : '해설 듣기'}
                palette={palette} disabled={sentences.length === 0}
                onPress={player.playing ? player.pause : player.play} />
            </View>
          </BottomActionBar>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  headerSpace: { width: MinTouchTarget },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, gap: 12 },
  photo: { width: '100%', borderRadius: 20 },
  notice: { flexDirection: 'row', gap: 12, padding: Spacing.three, borderWidth: 1.5, borderRadius: 20, marginVertical: Spacing.one },
  noticeTexts: { flex: 1, gap: 4 },
  noticeTitle: { fontSize: FontSize.label, fontWeight: 800 },
  noticeText: { fontSize: 16, lineHeight: 24 },
  sentence: { gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 20 },
  tag: { alignSelf: 'flex-start', fontSize: 14, fontWeight: 800, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sentenceText: { fontSize: FontSize.body, fontWeight: 600, lineHeight: 32 },
  body: { fontSize: FontSize.body, lineHeight: 30 },
  missing: { flex: 1, justifyContent: 'center', paddingHorizontal: ScreenPadding, gap: Spacing.three },
  row: { flexDirection: 'row' },
});
