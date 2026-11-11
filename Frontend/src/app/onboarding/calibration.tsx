// 와이어프레임 6: AI 자료 기반 화면 맞추기 (숫자 선택 → 색 보정 → 윤곽선 → 대비).
import { Image } from 'expo-image';
import { router, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { CALIBRATION, type CalibrationPlate } from '@/assets/images/calibration';
import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { Text } from '@/components/common/text';
import { TextButton } from '@/components/common/text-button';
import { showToast } from '@/components/common/toast';
import { PressableScale } from '@/components/common/pressable-scale';
import { ButtonRadius, FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import { useSettings } from '@/hooks/use-settings';
import { useSpeech } from '@/hooks/use-speech';
import { useVoiceAnswer } from '@/hooks/use-voice-answer';
import { saveVoiceAnswer } from '@/lib/api';
import { matchSpokenChoice } from '@/lib/spoken-answer';
import { advanceCalibration, initialCalibration, screeningSuggestion, type CalibrationAction, type CalibrationPhase } from '@/lib/calibration-flow';
import { CALIBRATION_COLOR_LABELS, type CalibrationColorType } from '@/types/calibration';

const PHASE_INDEX: Record<CalibrationPhase, number> = { screening: 0, manual: 0, color: 1, edge: 2, contrast: 3, complete: 3 };

export default function CalibrationScreen() {
  const { profile, loaded, error, saveCalibration, reloadProfile } = useProfile();
  const { loaded: settingsLoaded, finishOnboarding } = useSettings();
  const palette = getPalette('dark', profile.high_contrast);
  const [frames, setFrames] = useState(() => [initialCalibration()]);
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readySource, setReadySource] = useState<number | null>(null);
  const [failedSource, setFailedSource] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const lastAction = useRef<(typeof frames)[number] | null>(null);
  const savingLock = useRef(false);
  const state = frames[frames.length - 1];
  const { phase, index, result } = state;
  const suggestion = screeningSuggestion(state.answers);
  const disabled = !loaded || !settingsLoaded || error || saving;
  const plate: CalibrationPlate | undefined = phase === 'screening' ? CALIBRATION.screening.plates[index]
    : phase === 'color' && result.color_type !== 'normal' ? CALIBRATION.color[result.color_type].plates[index] : undefined;
  const source = plate?.image ?? (phase === 'edge' ? CALIBRATION.edge.images[index] : undefined);
  const imageReady = source === undefined || (readySource === source && failedSource !== source);
  const progress = phase === 'screening' ? `색 보정 · ${index + 1} / 3`
    : phase === 'manual' ? '색 보정 선택' : phase === 'color' ? `색 보정 세기 · ${Math.round(CALIBRATION.color[result.color_type === 'normal' ? 'protan' : result.color_type].levels[index] * 100)}%`
      : phase === 'edge' ? `윤곽선 강조 · ${Math.round(CALIBRATION.edge.levels[index] * 100)}%`
        : phase === 'contrast' ? `대비 · ${index + 1} / ${CALIBRATION.contrast.levels.length}` : '화면 맞추기 완료';
  const question = plate ? '어떤 숫자가 보이나요?' : phase === 'manual' ? '색 보정을 선택해 주세요'
    : phase === 'edge' ? '윤곽선이 또렷하게 보이나요?' : phase === 'contrast' ? '밝은 부분이 구분되나요?' : '보기 설정을 찾았어요';
  const description = plate ? '그림 속 숫자를 고르거나 말로 답해 주세요.' : phase === 'manual' ? '편하게 보는 데 필요한 색 보정을 골라 주세요.'
    : phase === 'edge' ? CALIBRATION.edge.question : phase === 'contrast' ? CALIBRATION.contrast.question : '설정을 확인하고 감상을 시작해 보세요.';
  // Number plates read only the question and the buttons, e.g. "어떤 숫자가 보이나요? 97, 45, 71, 숫자가 안 보여요".
  useSpeech(plate ? `${question} ${plate.choices.join(', ')}` : `${question} ${description}`);

  const moveBack = () => {
    if (savingLock.current) return;
    if (phase === 'manual' && manual && suggestion !== null) { setManual(false); return; }
    if (frames.length > 1) {
      lastAction.current = null;
      setFrames((previous) => previous.slice(0, -1));
      setManual(false);
      scroll.current?.scrollTo({ y: 0, animated: false });
    } else if (router.canGoBack()) router.back();
    else router.replace('/onboarding');
  };
  const disablePrevention = usePreventRemove(frames.length > 1 || saving, () => { moveBack(); });
  const act = (action: CalibrationAction) => {
    if (disabled || lastAction.current === state || (action.type === 'answer' && !imageReady)) return;
    const next = advanceCalibration(state, action);
    if (next === state) return;
    if (action.type === 'answer' && next.phase !== phase && (
      (phase === 'color' && next.result.severity === 0)
      || ((phase === 'edge' || phase === 'contrast') && action.value === 'not-visible')
    )) showToast('편한 강도를 찾지 못해 이 항목은 보정 없음으로 두었어요. 내 보정값에서 다시 조절할 수 있어요.', 'info');
    lastAction.current = state;
    setFrames((previous) => [...previous, next]);
    setManual(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const finish = async () => {
    if (disabled || savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    try {
      await saveCalibration(result);
      await finishOnboarding();
      disablePrevention();
      router.replace('/onboarding/result');
    } catch {
      savingLock.current = false;
      setSaving(false);
      showToast('설정을 저장하지 못했어요. 선택한 값은 유지돼요. 다시 시도해 주세요.', 'error');
    }
  };
  const voice = useVoiceAnswer();
  // 음성 답변 기록을 서버에 묶어 저장할 이번 화면 맞추기의 임의 ID (개인정보 없음)
  const [voiceSessionId] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  // 들은 말은 그 문제(frame)에서만 보여 준다. 다음 문제로 넘어가면 사라진다.
  const [heard, setHeard] = useState<{ frame: typeof state; message: string } | null>(null);
  const answerByVoice = () => {
    if (!plate || disabled || !imageReady) return;
    const frame = state;
    setHeard(null);
    voice.toggle({
      onText: (text) => {
        const match = matchSpokenChoice(text, plate.choices);
        // 인식된 글자와 맞춘 보기를 서버 DB에 남긴다. 저장 실패가 화면 맞추기 진행을 막지 않게 한다.
        void saveVoiceAnswer({
          session_id: voiceSessionId, step: frame.phase === 'color' ? 'color' : 'screening', choices: plate.choices,
          transcript: text, choice: match, expected: plate.answer, item: `${frame.phase}-${frame.index}`,
        }).catch(() => undefined);
        if (match) {
          showToast(`"${match}"(으)로 들었어요`, 'success');
          act({ type: 'answer', value: match });
        } else {
          setHeard({ frame, message: text ? `"${text}"(으)로 들었어요. 다시 말하거나 버튼을 눌러 주세요.` : '잘 들리지 않았어요. 다시 말하거나 버튼을 눌러 주세요.' });
        }
      },
      onError: (message) => setHeard({ frame, message }),
    });
  };
  const choice = (label: string, action: CalibrationAction) => {
    // 숫자 보기는 노란색으로 채우고, "숫자가 안 보여요"·색 보정 종류는 테두리 버튼으로 둔다.
    const filled = action.type === 'answer' && /^\d+$/.test(label);
    return (
    <PressableScale key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="선택하면 다음 화면으로 이동해요" accessibilityState={{ disabled: disabled || !imageReady }} disabled={disabled || !imageReady}
      onPress={() => act(action)} style={({ pressed }) => [styles.choice, { backgroundColor: filled ? palette.accent : palette.surface, borderColor: filled ? palette.accent : palette.border, opacity: disabled || !imageReady ? 0.4 : pressed ? 0.7 : 1 }]}>
      <Text lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.choiceText, { color: filled ? palette.accentText : palette.text }]}>{label}</Text>
    </PressableScale>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerSide}><BackButton label="이전 화면으로" palette={palette} onPress={moveBack} /></View>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>화면 맞추기</Text>
        <View style={styles.headerSide} />
      </View>
      <View style={styles.progressBar}>
        <View style={styles.progressRow}>
          <Text style={[styles.progressLabel, { color: palette.textSecondary }]}>{progress}</Text>
          <View style={styles.segments} accessibilityRole="progressbar" accessibilityLabel="화면 맞추기 진행" accessibilityValue={{ min: 1, max: 4, now: PHASE_INDEX[phase] + 1, text: `${PHASE_INDEX[phase] + 1} / 4 단계` }}>
            {[0, 1, 2, 3].map((step) => <View key={step} style={[styles.segment, { backgroundColor: step <= PHASE_INDEX[phase] ? palette.highlight : palette.outline }]} />)}
          </View>
        </View>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.heading, { color: palette.text }]}>{question}</Text>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>
        </View>

        {source !== undefined && <View style={[styles.picture, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
          <Image key={`${phase}-${index}-${retry}`} source={source} recyclingKey={`${phase}-${index}-${retry}`} contentFit="contain" transition={0} style={styles.image}
            accessible accessibilityLabel={plate ? '숫자가 점으로 그려진 보기 설정 그림' : '빗줄기와 다리 위 사람들이 있는 그림'}
            onLoad={() => { setReadySource(source); setFailedSource(null); }} onError={() => setFailedSource(source)} />
          {!imageReady && <View style={[styles.imageState, { backgroundColor: palette.surface }]}>
            {failedSource === source ? <><Text style={[styles.note, { color: palette.textSecondary }]}>그림을 불러오지 못했어요.</Text><View style={styles.buttonRow}><BigButton label="그림 다시 불러오기" palette={palette} onPress={() => { setReadySource(null); setFailedSource(null); setRetry((value) => value + 1); }} /></View></>
              : <ActivityIndicator accessibilityLabel="그림 불러오는 중" color={palette.text} />}
          </View>}
        </View>}
        {phase === 'contrast' && <CorrectionCanvas source={CALIBRATION.contrast.image} accessibilityLabel="흰 옷을 입은 인물과 뒤의 흰 커튼, 대비 비교 그림" correction={{ contrast: CALIBRATION.contrast.levels[index], brightness: 0, sharpen: 0, strength: 1 }} palette={palette} style={styles.contrastPicture} />}

        {plate && <View style={styles.choices}>{plate.choices.map((label) => choice(label, { type: 'answer', value: label }))}</View>}
        {plate && <PressableScale accessibilityRole="button"
          accessibilityLabel={voice.state === 'recording' ? '말하기 끝내기' : voice.state === 'thinking' ? '알아듣는 중' : '말로 답하기'}
          accessibilityHint={voice.state === 'recording' ? '누르면 녹음을 멈추고 답을 확인해요' : `누른 뒤 보이는 숫자를 말해 주세요. ${voice.maxSeconds}초 뒤 자동으로 멈춰요`}
          accessibilityState={{ disabled: disabled || !imageReady || voice.state === 'thinking', busy: voice.state === 'thinking' }}
          disabled={disabled || !imageReady || voice.state === 'thinking'} onPress={answerByVoice}
          style={({ pressed }) => [styles.voice, voice.state === 'recording'
            ? { backgroundColor: palette.highlight, borderColor: palette.highlight }
            : { backgroundColor: 'transparent', borderColor: palette.border },
          { opacity: disabled || !imageReady ? 0.4 : pressed ? 0.7 : 1 }]}>
          {voice.state === 'thinking' ? <ActivityIndicator color={palette.text} />
            : <SymbolView name={voice.state === 'recording' ? { ios: 'stop.fill', android: 'stop', web: 'stop' } : { ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={22} tintColor={voice.state === 'recording' ? palette.highlightText : palette.text} />}
          <Text style={[styles.voiceText, { color: voice.state === 'recording' ? palette.highlightText : palette.text }]}>
            {voice.state === 'recording' ? '듣고 있어요 · 다 말했으면 누르세요' : voice.state === 'thinking' ? '알아듣는 중…' : '말로 답하기'}
          </Text>
        </PressableScale>}
        {plate && heard?.frame === state && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.note, { color: palette.text }]}>{heard.message}</Text>}
        {plate && <Text style={[styles.note, { color: palette.textSecondary }]}>정답을 몰라도 괜찮아요.</Text>}
        {phase === 'manual' && <View style={styles.manual}>
          {!manual && suggestion !== null ? <>
            <Text style={[styles.note, { color: palette.textSecondary }]}>{suggestion === 'normal' ? '색 보정 없이 다음 단계로 갈 수 있어요.' : `${CALIBRATION_COLOR_LABELS[suggestion]}을 먼저 맞춰볼게요.`}</Text>
            <View style={styles.buttonRow}><BigButton label={suggestion === 'normal' ? '색 보정 없이 계속' : `${CALIBRATION_COLOR_LABELS[suggestion]}으로 계속`} palette={palette} disabled={disabled} onPress={() => act({ type: 'choose', value: suggestion })} /></View>
            <View style={styles.buttonRow}><BigButton label="직접 고르기" selected={false} palette={palette} disabled={disabled} onPress={() => setManual(true)} /></View>
          </> : <View style={styles.choices}>{(Object.keys(CALIBRATION_COLOR_LABELS) as CalibrationColorType[]).map((type) => choice(CALIBRATION_COLOR_LABELS[type], { type: 'choose', value: type }))}</View>}
        </View>}
        {(phase === 'edge' || phase === 'contrast') && <View style={styles.manual}>
          <View style={styles.buttonRow}><BigButton label="잘 보여요" palette={palette} disabled={disabled || !imageReady || (phase === 'contrast' && Platform.OS === 'web')} onPress={() => act({ type: 'answer', value: 'visible' })} /></View>
          <View style={styles.buttonRow}><BigButton label="아직 잘 안 보여요" selected={false} palette={palette} disabled={disabled || !imageReady || (phase === 'contrast' && Platform.OS === 'web')} onPress={() => act({ type: 'answer', value: 'not-visible' })} /></View>
          {phase === 'contrast' && Platform.OS === 'web' && <Text style={[styles.note, { color: palette.textSecondary }]}>대비 맞추기는 휴대폰에서 진행해 주세요. 웹에서는 아래 「이 단계 건너뛰기」로 기본값을 사용할 수 있어요.</Text>}
        </View>}
        {phase === 'complete' && <View style={styles.manual}>
          <Text style={[styles.note, { color: palette.textSecondary }]}>마이페이지에서 언제든 다시 맞출 수 있어요.</Text>
          <View style={styles.buttonRow}><BigButton label={saving ? '저장 중…' : '보정값 확인하기'} palette={palette} disabled={disabled} onPress={() => { void finish(); }} /></View>
        </View>}
        {phase !== 'complete' && <TextButton label="이 단계 건너뛰기" accessibilityHint="지금 단계는 보정 없음으로 두고 다음 단계로 이동해요" palette={palette} disabled={disabled} onPress={() => act({ type: 'skip' })} />}
        {error && <View style={styles.manual}><Text style={[styles.note, { color: palette.textSecondary }]}>기존 설정을 불러오지 못했어요.</Text><View style={styles.buttonRow}><BigButton label="설정 다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: Spacing.two },
  headerSide: { width: 88, minHeight: MinTouchTarget, justifyContent: 'center' },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.four },
  progressBar: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.one, paddingBottom: Spacing.two },
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  progressLabel: { fontSize: FontSize.label, fontWeight: 600 },
  segments: { flexDirection: 'row', gap: Spacing.one },
  segment: { width: 28, height: 8, borderRadius: 4 },
  intro: { gap: Spacing.two, alignItems: 'center' },
  heading: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 700, textAlign: 'center' },
  description: { fontSize: FontSize.body, lineHeight: 30, textAlign: 'center' },
  picture: { width: '100%', aspectRatio: 1, padding: Spacing.three, borderWidth: 1.5, borderRadius: 24, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageState: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.three, gap: Spacing.three },
  contrastPicture: { height: 300, borderRadius: 24, borderWidth: 1.5 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  voice: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 2, borderRadius: ButtonRadius, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  voiceText: { flexShrink: 1, fontSize: FontSize.label, fontWeight: 700, textAlign: 'center' },
  choice: { flexBasis: '45%', flexGrow: 1, minHeight: 76, borderWidth: 2, borderRadius: ButtonRadius, padding: 12, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontSize: FontSize.button, fontWeight: 700, textAlign: 'center', lineHeight: 32 },
  note: { fontSize: FontSize.label, lineHeight: 27, textAlign: 'center' },
  manual: { gap: 12 },
  buttonRow: { flexDirection: 'row' },
});
