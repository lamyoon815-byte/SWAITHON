import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { ButtonRadius, FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { NARRATION_OPTIONS } from '@/constants/narration';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { useCorrectionEntry } from '@/hooks/use-correction-entry';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseums, logout } from '@/lib/api';
import type { DeviceSettings } from '@/store/settings';
import type { NarrationMode } from '@/types/narration';

const FONT_OPTIONS = [
  { value: 'normal', label: '기본' },
  { value: 'large', label: '크게' },
  { value: 'xlarge', label: '아주 크게' },
] as const;

export default function MyPageScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await logout(); }
    catch { showToast('로그아웃하지 못했어요. 연결을 확인해 주세요', 'error'); }
    finally { setSigningOut(false); }
  };
  const { profile, loaded: profileLoaded, error: profileError, saveNarrationMode, reloadProfile } = useProfile();
  const correctionEntry = useCorrectionEntry();
  const palette = getPalette('dark', false);
  const bottomInset = useTabBarInset();
  const { settings, loaded, updateSettings } = useSettings();
  const { data: museums, error: museumError, reload: reloadMuseums } = useResource('museums', getMuseums);
  const [sheet, setSheet] = useState<'font' | 'narration' | 'museum' | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const narrationLabel = NARRATION_OPTIONS.find((option) => option.value === profile.narration_mode)?.label ?? '둘 다 듣기';
  const museum = museums?.find((m) => m.id === settings.recent_museum_id);
  const fontLabel = FONT_OPTIONS.find((option) => option.value === settings.font_scale)?.label ?? '기본';
  const card = { backgroundColor: palette.surface, borderColor: palette.outline };

  const selectFont = async (font_scale: DeviceSettings['font_scale']) => {
    await updateSettings({ font_scale });
    showToast('글씨 크기 설정을 저장했어요', 'success');
  };
  const clearMuseum = async () => {
    await updateSettings({ recent_museum_id: null });
    setSheet(null);
    showToast('미술관 기억을 지웠어요', 'success');
  };
  const selectNarration = async (mode: NarrationMode) => {
    if (savingMode) return;
    setSavingMode(true);
    try {
      await saveNarrationMode(mode);
      showToast('해설 방식을 저장했어요', 'success');
    } catch {
      showToast('해설 방식을 저장하지 못했어요. 다시 시도해 주세요', 'error');
    } finally {
      setSavingMode(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.four }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>마이페이지</Text>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, styles.settingsHeading, { color: palette.text }]}>내 화면 설정</Text>
          <View style={[styles.card, card]}>
            <SettingRow
              label="내 보정값"
              description={correctionEntry.description}
              palette={palette}
              onPress={correctionEntry.onPress}
            />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="글씨 크기" value={loaded ? fontLabel : '불러오는 중'} icon={{ ios: 'textformat.size', android: 'format_size' }} palette={palette} onPress={() => setSheet('font')} disabled={!loaded} />
            <View style={[styles.divider, { backgroundColor: palette.outline }]} />
            <SettingRow label="해설 방식" value={profileLoaded ? narrationLabel : '불러오는 중'} icon={{ ios: 'headphones', android: 'headphones' }} palette={palette} onPress={() => setSheet('narration')} disabled={!profileLoaded} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="관람 기록" icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} palette={palette} onPress={() => router.push('/history')} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="방문한 미술관" icon={{ ios: 'building.columns', android: 'account_balance' }} palette={palette} onPress={() => setSheet('museum')} />
          </View>
        </View>
        <View style={[styles.card, card]}>
          <SettingRow label="앱 소개 다시 보기" icon={{ ios: 'sparkles', android: 'auto_awesome' }} palette={palette} onPress={() => router.push('/onboarding')} />
        </View>
        <View style={styles.buttonRow}>
          <BigButton label={signingOut ? '로그아웃 중…' : '로그아웃'} selected={false} palette={palette} disabled={signingOut} onPress={signOut} />
        </View>
      </ScrollView>
      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={() => { if (!savingMode) setSheet(null); }}>
        <View style={[styles.scrim, { backgroundColor: Scrim }]}>
          <SafeAreaView style={styles.screen}>
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <View accessibilityViewIsModal style={[styles.sheet, card, sheet !== 'museum' && styles.fontSheet]}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>{sheet === 'font' ? '글씨 크기' : sheet === 'narration' ? '해설 방식' : '방문한 미술관'}</Text>
                {sheet === 'font' ? FONT_OPTIONS.map((option) => (
                  <View style={styles.buttonRow} key={option.value}>
                    <BigButton label={option.label} radio selected={settings.font_scale === option.value} palette={palette} onPress={() => { void selectFont(option.value); }} />
                  </View>
                )) : sheet === 'narration' ? (
                  <View style={styles.narrationOptions} accessibilityRole="radiogroup" accessibilityLabel="해설 방식 선택">
                    {profileError ? (
                      <>
                        <Text style={[styles.body, { color: palette.textSecondary }]}>저장된 설정을 불러오지 못했어요.</Text>
                        <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View>
                      </>
                    ) : NARRATION_OPTIONS.map((option) => {
                      const selected = profile.narration_mode === option.value;
                      const color = selected ? palette.accentText : palette.text;
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="radio"
                          accessibilityLabel={`${option.label}, ${option.description}`}
                          accessibilityState={{ checked: selected, disabled: savingMode }}
                          disabled={savingMode}
                          onPress={() => { void selectNarration(option.value); }}
                          style={({ pressed }) => [styles.narrationOption, { backgroundColor: selected ? palette.accent : palette.surface, borderColor: selected ? palette.accent : palette.border, opacity: savingMode ? 0.4 : pressed ? 0.7 : 1 }]}>
                          <Text
                            lineBreakStrategyIOS="hangul-word"
                            textBreakStrategy="highQuality"
                            android_hyphenationFrequency="none"
                            style={[styles.optionTitle, { color }]}>{option.label}</Text>
                          <Text
                            lineBreakStrategyIOS="hangul-word"
                            textBreakStrategy="highQuality"
                            android_hyphenationFrequency="none"
                            style={[styles.optionDescription, { color: selected ? color : palette.textSecondary }]}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                    {savingMode && <Text accessibilityLiveRegion="polite" style={[styles.description, { color: palette.textSecondary }]}>저장 중이에요.</Text>}
                  </View>
                ) : (
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
                {sheet !== 'museum' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={sheet === 'font' ? '글씨 크기 선택창 닫기' : '해설 방식 선택창 닫기'}
                    accessibilityState={{ disabled: savingMode }}
                    disabled={savingMode}
                    onPress={() => setSheet(null)}
                    style={({ pressed }) => [styles.fontClose, { opacity: pressed ? 0.7 : 1 }]}>
                    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} weight="semibold" tintColor={palette.textSecondary} />
                    </View>
                    <Text style={[styles.closeLabel, { color: palette.textSecondary }]}>닫기</Text>
                  </Pressable>
                ) : (
                  <View style={styles.buttonRow}><BigButton label="닫기" palette={palette} onPress={() => setSheet(null)} /></View>
                )}
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
  fontSheet: { paddingBottom: 14.4 },
  buttonRow: { flexDirection: 'row' },
  fontClose: { marginTop: Spacing.two, minHeight: MinTouchTarget, flexDirection: 'row', gap: Spacing.two, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two },
  closeLabel: { fontSize: FontSize.button, fontWeight: 700, textAlign: 'center' },
  narrationOptions: { gap: 12 },
  narrationOption: { minHeight: MinTouchTarget, borderRadius: ButtonRadius, borderWidth: 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.two },
  optionTitle: { fontSize: FontSize.button, fontWeight: 700, textAlign: 'left' },
  optionDescription: { fontSize: 16, lineHeight: 24, textAlign: 'left' },
  body: { fontSize: FontSize.body, lineHeight: 30 },
  museumName: { fontSize: FontSize.body, fontWeight: 700 },
});
