import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { ViewingControls } from '@/components/common/viewing-controls';
import { FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useViewing } from '@/hooks/use-viewing';

export default function CorrectionSettingsScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottom = useTabBarInset();
  const { values, saveViewing } = useViewing();
  const [draft, setDraft] = useState(values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await saveViewing(draft); showToast('보기 설정을 저장했어요', 'success'); router.back(); }
    catch { setError('보기 설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
      <BackButton label="마이페이지로" palette={palette} />
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>보기 설정 세부 조정</Text>
      <Text style={[styles.copy, { color: palette.textSecondary }]}>색과 윤곽선 미리보기는 각각의 그림으로 보여요. 함께 적용한 모습은 작품 화면에서 확인해 주세요.</Text>
      <ViewingControls value={draft} onChange={setDraft} palette={palette} />
      {!!error && <Text accessibilityRole="alert" style={[styles.copy, { color: palette.text }]}>{error}</Text>}
      <View style={styles.row}><BigButton label={busy ? '저장 중…' : '저장하기'} palette={palette} disabled={busy} onPress={save} /></View>
      <View style={styles.row}><BigButton label="저장하지 않고 돌아가기" palette={palette} selected={false} disabled={busy} onPress={() => router.back()} /></View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: ScreenPadding, gap: Spacing.three },
  title: { fontSize: FontSize.heading, fontWeight: '800', lineHeight: 38 },
  copy: { fontSize: 18, lineHeight: 28 }, row: { flexDirection: 'row' },
});
