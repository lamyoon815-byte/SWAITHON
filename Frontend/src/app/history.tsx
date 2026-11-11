import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { Text } from '@/components/common/text';
import { PressableScale } from '@/components/common/pressable-scale';
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useHistory } from '@/hooks/use-history';
import { groupHistory, historySummary } from '@/lib/history-format';
import type { ViewingRecord } from '@/store/history';

export default function HistoryScreen() {
  const palette = getPalette('dark', false);
  const { items, loaded, error, reloadHistory } = useHistory();
  const sections = useMemo(() => groupHistory(items), [items]);
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/mypage'); };
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <BackButton label="마이페이지로" palette={palette} onPress={back} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>관람 기록</Text>
        <View style={styles.headerSpace} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text accessibilityRole="header" style={[styles.date, { color: palette.text }]}>{section.title}</Text>}
        renderItem={({ item }) => <HistoryCard item={item} palette={palette} />}
        ListEmptyComponent={
          <View style={[styles.empty, loaded && !error && styles.emptyRaised]}>
            {loaded && !error && (
              <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.emptyIcon}>
                <SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={48} weight="regular" tintColor={palette.textSecondary} />
              </View>
            )}
            <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.textSecondary }]}>
              {!loaded ? '관람 기록을 불러오는 중이에요' : error ? '관람 기록을 불러오지 못했어요' : '아직 관람 기록이 없어요'}
            </Text>
            {loaded && error && <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadHistory(); }} /></View>}
          </View>
        }
      />
    </SafeAreaView>
  );
}

function HistoryCard({ item, palette }: { item: ViewingRecord; palette: Palette }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const summary = historySummary(item);
  const uri = item.artwork.image_url;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${item.artwork.title}, ${summary}`}
      accessibilityHint="기록된 보정값으로 작품을 열어요"
      onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: item.artwork.id, history: item.id } })}
      pressedScale={0.98}
      background={palette.surface}
      pressedBackground={palette.fill}
      style={[styles.card, { borderColor: palette.outline }]}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.thumbnail, { backgroundColor: palette.fill }]}>
        {uri && failedUri !== uri ? <Image source={{ uri }} contentFit="cover" style={styles.image} onError={() => setFailedUri(uri)} /> : <SymbolView name={{ ios: 'photo', android: 'image', web: 'image' }} size={30} tintColor={palette.textSecondary} />}
      </View>
      <View style={styles.cardText}>
        <Text lineBreakStrategyIOS="hangul-word" style={[styles.artworkTitle, { color: palette.text }]}>{item.artwork.title}</Text>
        <Text lineBreakStrategyIOS="hangul-word" style={[styles.summary, { color: palette.textSecondary }]}>{summary}</Text>
      </View>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={22} weight="semibold" tintColor={palette.text} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  headerSpace: { width: MinTouchTarget },
  list: { flexGrow: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four },
  date: { fontSize: FontSize.body, fontWeight: 700, paddingLeft: Spacing.two, marginTop: Spacing.four, marginBottom: 12 },
  card: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1.5, borderRadius: 24, marginBottom: 12 },
  thumbnail: { width: 72, height: 72, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  cardText: { flex: 1, gap: Spacing.two },
  artworkTitle: { fontSize: FontSize.body, fontWeight: 700 },
  summary: { fontSize: FontSize.label, lineHeight: 27 },
  empty: { flex: 1, justifyContent: 'center', paddingVertical: Spacing.six, gap: Spacing.four },
  message: { fontSize: FontSize.body, lineHeight: 30, textAlign: 'center' },
  emptyIcon: { alignItems: 'center' },
  emptyRaised: { transform: [{ translateY: -(Spacing.three + 10) }] },
  buttonRow: { flexDirection: 'row' },
});
