import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { useCorrectionEntry } from '@/hooks/use-correction-entry';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseums } from '@/lib/api';
import type { DeviceSettings } from '@/store/settings';

const FONT_OPTIONS = [
  { value: 'normal', label: '기본' },
  { value: 'large', label: '크게' },
  { value: 'xlarge', label: '아주 크게' },
] as const;

export default function MyPageScreen() {
  const correctionEntry = useCorrectionEntry();
  const palette = getPalette('dark', false);
  const bottomInset = useTabBarInset();
  const { settings, loaded, updateSettings } = useSettings();
  const { data: museums, error: museumError, reload: reloadMuseums } = useResource('museums', getMuseums);
  const [sheet, setSheet] = useState<'font' | 'museum' | null>(null);
  const museum = museums?.find((m) => m.id === settings.recent_museum_id);
  const fontLabel = FONT_OPTIONS.find((option) => option.value === settings.font_scale)?.label ?? '기본';
  const card = { backgroundColor: palette.surface, borderColor: palette.outline };
  const preparing = (label: string) => showToast(`${label} 화면은 준비 중이에요`);

  const selectFont = async (font_scale: DeviceSettings['font_scale']) => {
    await updateSettings({ font_scale });
    setSheet(null);
    showToast('글씨 크기 설정을 저장했어요', 'success');
  };
  const clearMuseum = async () => {
    await updateSettings({ recent_museum_id: null });
    setSheet(null);
    showToast('미술관 기억을 지웠어요', 'success');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.four }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>마이페이지</Text>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, styles.settingsHeading, { color: palette.text }]}>내 화면 설정</Text>
          <View style={[styles.card, card]}>
            <SettingRow label="내 보정값" description={correctionEntry.description} palette={palette} onPress={correctionEntry.onPress} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="글씨 크기" value={loaded ? fontLabel : '불러오는 중'} icon={{ ios: 'textformat.size', android: 'format_size' }} palette={palette} onPress={() => setSheet('font')} disabled={!loaded} />
            <View style={[styles.divider, { backgroundColor: palette.outline }]} />
            <SettingRow label="해설 방식" value="설정 전" icon={{ ios: 'headphones', android: 'headphones' }} palette={palette} onPress={() => preparing('해설 방식 설정')} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="관람 기록" icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} palette={palette} onPress={() => preparing('관람 기록')} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="방문한 미술관" icon={{ ios: 'building.columns', android: 'account_balance' }} palette={palette} onPress={() => setSheet('museum')} />
          </View>
        </View>
      </ScrollView>
      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <View style={[styles.scrim, { backgroundColor: Scrim }]}>
          <SafeAreaView style={styles.screen}>
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <View accessibilityViewIsModal style={[styles.sheet, card]}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>{sheet === 'font' ? '글씨 크기' : '방문한 미술관'}</Text>
                {sheet === 'font' ? FONT_OPTIONS.map((option) => (
                  <View style={styles.buttonRow} key={option.value}>
                    <BigButton label={option.label} radio selected={settings.font_scale === option.value} palette={palette} onPress={() => { void selectFont(option.value); }} />
                  </View>
                )) : (
                  <>
                    <Text style={[styles.body, { color: palette.textSecondary }]}>현재는 마지막으로 선택한 미술관 하나만 기억해요. 실제 방문 이력은 저장하지 않아요.</Text>
                    <Text style={[styles.museumName, { color: palette.text }]}>
                      {museumError ? '미술관 정보를 불러오지 못했어요' : !loaded || (settings.recent_museum_id && !museums) ? '미술관을 불러오는 중이에요' : museum?.name ?? '저장된 미술관이 없어요'}
                    </Text>
                    {!!museumError && (
                      <View style={styles.buttonRow}>
                        <BigButton label="다시 불러오기" selected={false} palette={palette} onPress={reloadMuseums} />
                      </View>
                    )}
                    <View style={styles.buttonRow}>
                      <BigButton label="미술관 기억 지우기" selected={false} palette={palette} disabled={!loaded || !settings.recent_museum_id} onPress={() => { void clearMuseum(); }} />
                    </View>
                  </>
                )}
                <View style={styles.buttonRow}><BigButton label="닫기" palette={palette} onPress={() => setSheet(null)} /></View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type RowProps = {
  label: string;
  description?: string;
  value?: string;
  icon?: { ios: SFSymbol; android: AndroidSymbol };
  palette: Palette;
  onPress: () => void;
  disabled?: boolean;
};

function SettingRow({ label, description, value, icon, palette, onPress, disabled }: RowProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[label, description, value].filter(Boolean).join(', ')} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.fill }]}>
      {icon && <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ...icon, web: icon.android }} size={26} tintColor={palette.text} /></View>}
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        {description && <Text style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>}
      </View>
      {value && <Text style={[styles.value, { color: palette.textSecondary }]}>{value}</Text>}
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} weight="semibold" tintColor={palette.text} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.four },
  title: { fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center', marginBottom: Spacing.six },
  section: { gap: 12 },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: 700, marginBottom: Spacing.two },
  settingsHeading: { paddingLeft: Spacing.two },
  card: { borderWidth: 1.5, borderRadius: 24, overflow: 'hidden' },
  row: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  rowText: { flex: 1, gap: Spacing.two },
  label: { fontSize: FontSize.body, fontWeight: 700 },
  description: { fontSize: FontSize.label, lineHeight: 27 },
  value: { flexShrink: 1, fontSize: FontSize.label, textAlign: 'right' },
  divider: { height: 1, marginHorizontal: Spacing.three },
  scrim: { flex: 1 },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: ScreenPadding },
  sheet: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: 12, borderWidth: 1.5, borderRadius: 24 },
  buttonRow: { flexDirection: 'row' },
  body: { fontSize: FontSize.body, lineHeight: 30 },
  museumName: { fontSize: FontSize.body, fontWeight: 700 },
});
