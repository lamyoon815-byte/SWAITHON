import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SegmentedControl } from '@/components/common/segmented-control';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { showToast } from '@/components/common/toast';
import { PressableScale } from '@/components/common/pressable-scale';
import { CORRECTION_CONTROLS, CorrectionSlider } from '@/components/mypage/correction-slider';
import { CalibrationSlider } from '@/components/mypage/calibration-slider';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import { correctionSettings, correctionSettingsChanged } from '@/lib/correction-settings';
import { combinedCorrectionPreview } from '@/lib/combined-correction-preview';
import { CALIBRATION_COLOR_LABELS, type CalibrationColorType } from '@/types/calibration';
import type { ViewingSettings } from '@/types/profile';

export default function CorrectionScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { profile, loaded, error, saveViewingSettings, reloadProfile } = useProfile();
  const palette = getPalette('dark', profile.high_contrast);
  const [barHeight, setBarHeight] = useState(0);
  const [draft, setDraft] = useState<ViewingSettings | null>(null);
  const [original, setOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const savingLock = useRef(false);
  const saved = correctionSettings(profile);
  const values = draft ?? saved;
  const dirty = correctionSettingsChanged(values, saved);
  const preview = combinedCorrectionPreview(values, original);
  const disabled = !loaded || error || saving;

  const disablePrevention = usePreventRemove((dirty || saving) && !leaving, ({ repeat }) => {
    if (saving) return;
    pendingNavigation.current = repeat;
    setConfirmDiscard(true);
  });

  const goBack = () => {
    if (from === 'onboarding') router.replace('/');
    else if (router.canGoBack()) router.back();
    else router.replace('/mypage');
  };
  const cancel = () => {
    if (savingLock.current) return;
    if (dirty) {
      pendingNavigation.current = null;
      setConfirmDiscard(true);
    } else goBack();
  };
  const recalibrate = () => {
    if (disabled || savingLock.current) return;
    if (dirty) {
      pendingNavigation.current = () => router.replace('/onboarding/calibration');
      setConfirmDiscard(true);
    } else router.replace('/onboarding/calibration');
  };
  const discard = () => {
    setLeaving(true);
    setConfirmDiscard(false);
    disablePrevention();
    if (pendingNavigation.current) pendingNavigation.current();
    else goBack();
  };
  const save = async () => {
    if (disabled || savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    try {
      await saveViewingSettings(values);
      setDraft(null);
      setLeaving(true);
      disablePrevention();
      showToast('보정값을 저장했어요', 'success');
      if (from === 'onboarding') router.replace('/onboarding/result');
      else goBack();
    } catch {
      showToast('저장하지 못했어요. 변경값은 유지돼요. 다시 시도해 주세요', 'error');
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <BackButton label="마이페이지로" palette={palette} onPress={() => { if (!saving) cancel(); }} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>내 보정값</Text>
        <View style={styles.headerSpace} />
      </View>

      <View style={[styles.pinnedPreview, { backgroundColor: palette.background }]}>
        <CorrectionCanvas
          source={preview}
          accessibilityLabel="반 고흐의 프로방스의 농가, 색 보정과 윤곽선 강조를 함께 적용한 미리보기"
          correction={{ ...values, strength: 1 }}
          original={original}
          palette={palette}
          style={styles.preview}
        />
        <View pointerEvents="none" style={[styles.previewFade, {
          experimental_backgroundImage: `linear-gradient(180deg, ${palette.background} 0%, ${palette.background}CC 35%, ${palette.background}00 100%)`,
        }]} />
      </View>

      <ScrollView style={styles.settingsScroll} contentContainerStyle={[styles.content, { paddingBottom: barHeight + 40 }]}>
        <SegmentedControl accessibilityLabel="보기 방식" palette={palette} value={original ? 'original' : 'corrected'} onChange={(next) => setOriginal(next === 'original')}
          options={[{ value: 'corrected', label: '보정본' }, { value: 'original', label: '원본' }] as const} />
        {(!loaded || error) && (
          <Text accessibilityLiveRegion="polite" style={[styles.note, { color: palette.textSecondary }]}>
            {error ? '저장된 보정값을 불러오지 못했어요.' : '보정값을 불러오는 중이에요.'}
          </Text>
        )}
        {error && <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View>}

        <View style={[styles.controls, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
          <View style={styles.colorSection}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>색 보정 종류</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="색 보정 종류" style={styles.colorChoices}>
              {(Object.keys(CALIBRATION_COLOR_LABELS) as CalibrationColorType[]).map((type) => {
                const selected = values.color_type === type;
                return <PressableScale key={type} accessibilityRole="radio" accessibilityLabel={CALIBRATION_COLOR_LABELS[type]} accessibilityState={{ checked: selected, disabled: disabled || original }} disabled={disabled || original}
                  onPress={() => setDraft({ ...values, color_type: type, severity: type === 'normal' ? 0 : values.severity })}
                  style={({ pressed }) => [styles.colorChoice, { backgroundColor: selected ? palette.highlight : palette.fill, borderColor: selected ? palette.highlight : palette.border, opacity: disabled || original ? 0.4 : pressed ? 0.7 : 1 }]}>
                  <Text lineBreakStrategyIOS="hangul-word" style={[styles.colorChoiceLabel, { color: selected ? palette.highlightText : palette.text, fontWeight: selected ? 800 : 600 }]}>{CALIBRATION_COLOR_LABELS[type]}</Text>
                </PressableScale>;
              })}
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: palette.outline }]} />
          <CalibrationSlider label="색 보정 세기" value={values.severity} disabled={disabled || original || values.color_type === 'normal'} palette={palette}
            onChange={(severity) => setDraft({ ...values, severity })} />
          {values.color_type === 'normal' && <Text style={[styles.cardNote, { color: palette.textSecondary }]}>색 보정 종류를 선택하면 세기를 조절할 수 있어요.</Text>}
        </View>
        <View style={[styles.controls, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
          <CalibrationSlider label="윤곽선 강조" value={values.edge} disabled={disabled || original} palette={palette}
            onChange={(edge) => setDraft({ ...values, edge })} />
        </View>

        <View style={[styles.controls, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
          {CORRECTION_CONTROLS.map((control, i) => (
            <View key={control.field}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: palette.outline }]} />}
              <CorrectionSlider
                control={control}
                value={values[control.field]}
                disabled={disabled || original}
                palette={palette}
                onChange={(field, value) => setDraft({ ...values, [field]: value })}
              />
            </View>
          ))}
        </View>
        <View style={[styles.divider, { backgroundColor: palette.outline }]} />
        <PressableScale accessibilityRole="button" accessibilityLabel="보정값 다시 맞추기" accessibilityHint="화면 맞추기의 숫자 선택 단계부터 다시 시작해요" accessibilityState={{ disabled }} disabled={disabled} onPress={recalibrate}
          pressedScale={0.98} background={`${palette.background}00`} pressedBackground={palette.fill}
          style={[styles.linkRow, { opacity: disabled ? 0.4 : 1 }]}>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.linkIcon, { backgroundColor: palette.fill }]}>
            <SymbolView name={{ ios: 'arrow.counterclockwise', android: 'restart_alt', web: 'restart_alt' }} size={20} weight="semibold" tintColor={palette.highlight} />
          </View>
          <Text style={[styles.linkLabel, { color: palette.text }]}>보정값 다시 맞추기</Text>
          <View accessible={false} importantForAccessibility="no-hide-descendants">
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} weight="semibold" tintColor={palette.textSecondary} />
          </View>
        </PressableScale>
      </ScrollView>

      <BottomActionBar background={palette.background} onHeight={setBarHeight}>
        <View style={styles.footerRow}>
          <View style={styles.footerSave}><BigButton label={saving ? '저장 중…' : '변경사항 저장'} palette={palette} disabled={disabled} onPress={() => { void save(); }} /></View>
        </View>
      </BottomActionBar>

      <ConfirmDialog
        visible={confirmDiscard}
        title="변경사항을 폐기할까요?"
        message="저장하지 않으면 변경 사항이 사라져요."
        cancelLabel="계속 조절하기"
        confirmLabel="나가기"
        palette={palette}
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  headerSpace: { width: MinTouchTarget },
  pinnedPreview: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, zIndex: 1 },
  previewFade: { position: 'absolute', left: 0, right: 0, bottom: -8, height: 8 },
  settingsScroll: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.three },
  preview: { height: 210, borderRadius: 24 },
  controls: { paddingHorizontal: Spacing.three, borderWidth: 1.5, borderRadius: 24 },
  colorSection: { paddingVertical: Spacing.three, gap: Spacing.three },
  sectionTitle: { fontSize: FontSize.body, fontWeight: 700 },
  colorChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  colorChoice: { flexBasis: '45%', flexGrow: 1, minHeight: MinTouchTarget, padding: Spacing.two, borderWidth: 2, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colorChoiceLabel: { fontSize: FontSize.label, lineHeight: 27, textAlign: 'center' },
  cardNote: { fontSize: FontSize.label, lineHeight: 27, paddingBottom: Spacing.three },
  divider: { height: 1 },
  note: { fontSize: FontSize.label, lineHeight: 27 },
  linkRow: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: -Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderRadius: 12 },
  linkIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, fontSize: FontSize.body, fontWeight: 700 },
  footerRow: { flexDirection: 'row', minHeight: MinTouchTarget + Spacing.two },
  footerSave: { flex: 1, flexDirection: 'row' },
  buttonRow: { flexDirection: 'row' },
  scrim: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: 'center', padding: ScreenPadding },
  dialog: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, borderRadius: 24, borderWidth: 1.5, gap: Spacing.three },
  dialogTitle: { fontSize: FontSize.heading, fontWeight: 700 },
  dialogActions: { gap: 12 },
});
