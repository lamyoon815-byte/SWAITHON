import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CALIBRATION } from '@/assets/images/calibration';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { ColorChoices } from '@/components/common/viewing-controls';
import { FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useViewing } from '@/hooks/use-viewing';
import { COLOR_LABELS, DEFAULT_VIEWING, screeningColor, type ColorType, type ViewingProfile } from '@/lib/calibration';

type Stage = 'intro' | 'screening' | 'choice' | 'color' | 'edge' | 'contrast' | 'summary';

export default function OnboardingScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const { values, saveViewing } = useViewing();
  const [draft, setDraft] = useState<ViewingProfile>(values);
  const [stage, setStage] = useState<Stage>('intro');
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Exclude<ColorType, 'normal'>[]>([]);
  const [choice, setChoice] = useState<ColorType | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const move = (next: Stage) => { setIndex(0); setStage(next); };
  const save = async (value = draft) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await saveViewing(value); router.replace('/'); }
    catch { setError('보기 설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const screening = CALIBRATION.screening.plates[index];
  const color = draft.color_type === 'normal' ? null : CALIBRATION.color[draft.color_type];
  const plate = stage === 'screening' ? screening : stage === 'color' ? color?.plates[index] : null;

  const answer = (value: string) => {
    if (stage === 'screening') {
      const next = value === screening.answer ? failed : [...failed, screening.color_type];
      setFailed(next);
      if (index < 2) setIndex(index + 1);
      else {
        const result = screeningColor(next);
        setChoice(result); setAmbiguous(result === null); move('choice');
      }
    } else if (color) {
      if (value === color.plates[index].answer || index === color.levels.length - 1) {
        setDraft({ ...draft, severity: color.levels[index] }); move('edge');
      } else setIndex(index + 1);
    }
  };

  const startColor = () => {
    if (!choice) return;
    setDraft({ ...draft, color_type: choice, severity: 0 });
    move(choice === 'normal' ? 'edge' : 'color');
  };
  const advance = (seen: boolean) => {
    if (stage === 'edge') {
      if (seen || index === CALIBRATION.edge.levels.length - 1) {
        setDraft({ ...draft, edge: CALIBRATION.edge.levels[index] }); move('contrast');
      } else setIndex(index + 1);
    } else if (stage === 'contrast') {
      if (seen || index === CALIBRATION.contrast.levels.length - 1) {
        setDraft({ ...draft, contrast: CALIBRATION.contrast.levels[index] }); move('summary');
      } else setIndex(index + 1);
    }
  };

  const title = stage === 'intro' ? '내게 편한 보기 설정'
    : stage === 'screening' ? `색 구분 확인 · ${index + 1} / 3`
      : stage === 'choice' ? '보정 종류를 골라 주세요'
        : stage === 'color' ? `색 보정 세기 · ${Math.round((color?.levels[index] ?? 0) * 100)}%`
          : stage === 'edge' ? `선 굵기 · ${Math.round(CALIBRATION.edge.levels[index] * 100)}%`
            : stage === 'contrast' ? `대비 · ${Math.round(CALIBRATION.contrast.levels[index] * 100)}%` : '내 보기 설정';
  const action = (label: string, onPress: () => void, secondary = false, disabled = false) =>
    <View key={label} style={styles.row}><BigButton label={label} onPress={onPress} palette={palette}
      selected={!secondary} disabled={disabled || busy} /></View>;

  return <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.title, { color: palette.text }]}>{title}</Text>
      {stage === 'intro' && <>
        <Text style={[styles.copy, { color: palette.text }]}>숫자와 그림을 보며 색 보정, 선 굵기, 대비를 맞춰요. 한 번에 하나씩, 편하게 골라 주세요.</Text>
        <Text style={[styles.copy, { color: palette.textSecondary }]}>의료 진단이 아닌 보기 설정이에요. 이 기기에 저장되며 마이페이지에서 언제든 바꿀 수 있어요.</Text>
        {action('보기 설정 시작', () => { setDraft({ ...DEFAULT_VIEWING, brightness: values.brightness, sharpness: values.sharpness }); move('screening'); })}
        {action('지금 설정으로 시작하기', () => { void save(values); }, true)}
      </>}
      {plate && <>
        <Text style={[styles.copy, { color: palette.text }]}>{CALIBRATION.screening.question}</Text>
        <Image source={plate.image} accessibilityLabel="색 구분 숫자 그림" style={styles.image} contentFit="contain" />
        {plate.choices.map((value) => action(value, () => answer(value)))}
        {stage === 'color' && action('색 보정 건너뛰기', () => { setDraft({ ...draft, severity: 0 }); move('edge'); }, true)}
        {stage === 'screening' && action('직접 고르기', () => { setChoice(null); setAmbiguous(true); move('choice'); }, true)}
      </>}
      {stage === 'choice' && <>
        <Text style={[styles.copy, { color: palette.text }]}>{ambiguous
          ? '숫자 그림만으로는 보정 종류를 정하기 어려워요. 알고 있는 종류를 직접 골라 주세요. 모르면 없음을 선택하고 나중에 바꿀 수 있어요.'
          : '숫자가 보였어도 알고 있는 색약 종류가 있다면 직접 바꿔 주세요.'}</Text>
        <ColorChoices value={choice} onChange={setChoice} palette={palette} />
        {action('이 종류로 계속하기', startColor, false, choice === null)}
      </>}
      {stage === 'edge' && <>
        <Text style={[styles.copy, { color: palette.text }]}>{CALIBRATION.edge.question}</Text>
        <Image source={CALIBRATION.edge.images[index]} accessibilityLabel="빗줄기와 다리 위 사람들" style={styles.image} contentFit="contain" />
      </>}
      {stage === 'contrast' && <>
        <Text style={[styles.copy, { color: palette.text }]}>{CALIBRATION.contrast.question}</Text>
        <CorrectionCanvas source={CALIBRATION.contrast.image} accessibilityLabel="흰 옷과 흰 커튼 대비 그림" palette={palette}
          correction={{ contrast: CALIBRATION.contrast.levels[index], brightness: 0, sharpen: 0, strength: 1 }} />
      </>}
      {(stage === 'edge' || stage === 'contrast') && <>
        {action('잘 보여요', () => advance(true))}
        {action('아직 잘 안 보여요', () => advance(false), true)}
        {action('이 항목 건너뛰기', () => {
          if (stage === 'edge') { setDraft({ ...draft, edge: 0 }); move('contrast'); }
          else { setDraft({ ...draft, contrast: 1 }); move('summary'); }
        }, true)}
      </>}
      {stage === 'summary' && <>
        <Text style={[styles.copy, { color: palette.text }]}>색 보정: {COLOR_LABELS[draft.color_type]} · {Math.round(draft.severity * 100)}%{'\n'}선 굵기: {Math.round(draft.edge * 100)}%{'\n'}대비: {Math.round(draft.contrast * 100)}%</Text>
        <Text style={[styles.copy, { color: palette.textSecondary }]}>색과 윤곽선을 함께 보정한 모습은 실제 작품에서 확인할 수 있어요.</Text>
        {action(busy ? '저장 중…' : '저장하고 작품 보기', () => { void save(); })}
        {action('처음부터 다시 맞추기', () => { setFailed([]); move('intro'); }, true)}
      </>}
      {!!error && <Text accessibilityRole="alert" style={[styles.copy, { color: palette.text }]}>{error}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: ScreenPadding, gap: Spacing.three },
  title: { fontSize: FontSize.heading, lineHeight: 38, fontWeight: '800' },
  copy: { fontSize: FontSize.body, lineHeight: 30 }, image: { width: '100%', height: 300 }, row: { flexDirection: 'row' },
});
