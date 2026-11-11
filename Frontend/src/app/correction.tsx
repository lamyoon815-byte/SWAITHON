import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { showToast } from '@/components/common/toast';
import { CORRECTION_CONTROLS, CorrectionSlider } from '@/components/mypage/correction-slider';
import { ButtonGap, FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import type { CorrectionField } from '@/lib/profile-format';

type Draft = Record<CorrectionField, number>;

export default function CorrectionScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { profile, loaded, error, saveCorrection, reloadProfile } = useProfile();
  const palette = getPalette('dark', profile.high_contrast);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const values = draft ?? profile;
  const dirty = CORRECTION_CONTROLS.some(({ field }) => values[field] !== profile[field]);
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
    if (dirty) {
      pendingNavigation.current = null;
      setConfirmDiscard(true);
    } else goBack();
  };
  const discard = () => {
    setLeaving(true);
    setConfirmDiscard(false);
    disablePrevention();
    if (pendingNavigation.current) pendingNavigation.current();
    else goBack();
  };
  const save = async () => {
    if (disabled) return;
    setSaving(true);
    try {
      await saveCorrection(values);
      setDraft(null);
      setLeaving(true);
      disablePrevention();
      showToast('보정값을 저장했어요', 'success');
      goBack();
    } catch {
      showToast('저장하지 못했어요. 변경값은 유지돼요. 다시 시도해 주세요', 'error');
    } finally {
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

      <ScrollView contentContainerStyle={styles.content}>
        <CorrectionCanvas
          source={require('@/assets/images/sample/starry-night.jpg')}
          accessibilityLabel="보정 미리보기 샘플 작품, 별이 빛나는 밤"
          correction={{ ...values, strength: 1 }}
          original={original}
          palette={palette}
          style={styles.preview}
        />
        <View style={styles.toggle}>
          <View style={styles.toggleButton}><BigButton label="보정본" selected={!original} palette={palette} onPress={() => setOriginal(false)} /></View>
          <View style={styles.toggleButton}><BigButton label="원본" selected={original} palette={palette} onPress={() => setOriginal(true)} /></View>
        </View>

        {(!loaded || error) && (
          <Text accessibilityLiveRegion="polite" style={[styles.note, { color: palette.textSecondary }]}>
            {error ? '저장된 보정값을 불러오지 못했어요.' : '보정값을 불러오는 중이에요.'}
          </Text>
        )}
        {error && <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View>}

        <View style={[styles.controls, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
          {CORRECTION_CONTROLS.map((control, i) => (
            <View key={control.field}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: palette.outline }]} />}
              <CorrectionSlider
                control={control}
                value={values[control.field]}
                disabled={disabled || original}
                palette={palette}
                onChange={(field, value) => setDraft({ contrast: values.contrast, brightness: values.brightness, sharpen: values.sharpen, [field]: value })}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset + Spacing.two, backgroundColor: palette.background }]}>
        <View style={styles.buttonRow}><BigButton label={saving ? '저장 중…' : '변경사항 저장'} palette={palette} disabled={disabled} onPress={() => { void save(); }} /></View>
        <View style={styles.buttonRow}><BigButton label="변경 취소" selected={false} palette={palette} disabled={saving} onPress={cancel} /></View>
      </View>

      <Modal visible={confirmDiscard} transparent animationType="fade" onRequestClose={() => setConfirmDiscard(false)}>
        <View style={[styles.scrim, { backgroundColor: Scrim }]}>
          <SafeAreaView style={styles.screen}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
                <Text accessibilityRole="header" style={[styles.dialogTitle, { color: palette.text }]}>변경사항을 폐기할까요?</Text>
                <Text style={[styles.note, { color: palette.textSecondary }]}>저장하지 않으면 변경 사항이 사라져요.</Text>
                <View style={styles.dialogActions}>
                  <View style={styles.buttonRow}><BigButton label="계속 조절하기" palette={palette} onPress={() => setConfirmDiscard(false)} /></View>
                  <View style={styles.buttonRow}><BigButton label="나가기" selected={false} palette={palette} onPress={discard} /></View>
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  headerSpace: { width: MinTouchTarget },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingBottom: Spacing.three, gap: Spacing.three },
  preview: { height: 210, borderRadius: 24 },
  toggle: { flexDirection: 'row', gap: ButtonGap },
  toggleButton: { flex: 1, flexDirection: 'row' },
  controls: { paddingHorizontal: Spacing.three, borderWidth: 1.5, borderRadius: 24 },
  divider: { height: 1 },
  note: { fontSize: FontSize.label, lineHeight: 27 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.two, gap: 12 },
  buttonRow: { flexDirection: 'row' },
  scrim: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: 'center', padding: ScreenPadding },
  dialog: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, borderRadius: 24, borderWidth: 1.5, gap: Spacing.three },
  dialogTitle: { fontSize: FontSize.heading, fontWeight: 700 },
  dialogActions: { gap: 12 },
});
