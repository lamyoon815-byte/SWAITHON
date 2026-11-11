// 와이어프레임 6: AI 자료 기반 화면 맞추기 (숫자 선택 → 색 보정 → 윤곽선 → 대비).
import { Image } from 'expo-image';
import { router, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { CALIBRATION, CALIBRATION_NOT_VISIBLE, type CalibrationPlate } from '@/assets/images/calibration';
import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
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
import { stopSpeaking } from '@/lib/speech';
import { advanceCalibration, initialCalibration, screeningSuggestion, type CalibrationAction, type CalibrationPhase } from '@/lib/calibration-flow';
import { CALIBRATION_COLOR_LABELS, type CalibrationColorType } from '@/types/calibration';

const PHASE_INDEX: Record<CalibrationPhase, number> = { screening: 0, manual: 0, color: 1, edge: 2, contrast: 3, complete: 3 };
const STEP_DETAILS = [
  { name: '색각 확인', count: '3문제' },
  { name: '색 보정', count: '최대 5문제' },
  { name: '윤곽선', count: '최대 6문제' },
  { name: '대비', count: '최대 6문제' },
] as const;

export default function CalibrationScreen() {
  const { profile, loaded, error, saveCalibration, reloadProfile } = useProfile();
  const { loaded: settingsLoaded, finishOnboarding } = useSettings();
  const palette = getPalette('dark', profile.high_contrast);
  const [started, setStarted] = useState(false);
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
  const colorLevels = CALIBRATION.color[result.color_type === 'normal' ? 'protan' : result.color_type].levels;
  const progress = phase === 'screening' ? `색각 확인 · 문제 ${index + 1} / ${CALIBRATION.screening.plates.length}`
    : phase === 'manual' ? '색각 확인 결과' : phase === 'color' ? `색 보정 · 문제 ${index + 1} / ${colorLevels.length}`
      : phase === 'edge' ? `윤곽선 · 문제 ${index + 1} / ${CALIBRATION.edge.levels.length}`
        : phase === 'contrast' ? `대비 · 문제 ${index + 1} / ${CALIBRATION.contrast.levels.length}` : '색각 맞춤 테스트 완료';
  const progressRatio = phase === 'screening' ? (index / CALIBRATION.screening.plates.length) * 0.25
    : phase === 'manual' ? 0.25
      : phase === 'color' ? 0.25 + (index / colorLevels.length) * 0.25
        : phase === 'edge' ? 0.5 + (index / CALIBRATION.edge.levels.length) * 0.25
          : phase === 'contrast' ? 0.75 + (index / CALIBRATION.contrast.levels.length) * 0.25 : 1;
  const progressPercent = Math.round(progressRatio * 100);
  const question = plate ? '어떤 숫자가 보이나요?' : phase === 'manual' ? '색 보정을 선택해 주세요'
    : phase === 'edge' ? '윤곽선이 또렷하게 보이나요?' : phase === 'contrast' ? '밝은 부분이 구분되나요?' : '보기 설정을 찾았어요';
  const description = plate ? '그림 속 숫자를 음성으로 말해 주세요. 숫자가 보이지 않으면 “안 보여요”라고 말해 주세요.' : phase === 'manual' ? '편하게 보는 데 필요한 색 보정을 골라 주세요.'
    : phase === 'edge' ? CALIBRATION.edge.question : phase === 'contrast'
      ? `같은 그림에서 대비만 단계별로 높이고 있어요. 흰 옷과 뒤쪽 흰 커튼의 경계를 비교해 주세요. 현재 대비 ${CALIBRATION.contrast.levels[index].toFixed(1)}배예요.`
      : '설정을 확인하고 감상을 시작해 보세요.';
  const questionPhase = phase === 'screening' || phase === 'color' || phase === 'edge' || phase === 'contrast';
  const introSpeech = '색각 맞춤 테스트를 시작하기 전에 안내해 드릴게요. 화면 밝기를 편하게 맞추고, 그림 속 숫자를 음성으로 답해 주세요. 숫자가 보이지 않으면 안 보여요라고 말하면 돼요.';
  useSpeech(started ? `${question} ${description}` : introSpeech);

  const leaveTest = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/onboarding');
  };

  const moveBack = () => {
    if (savingLock.current) return;
    if (phase === 'manual' && manual && suggestion !== null) { setManual(false); return; }
    if (frames.length > 1) {
      lastAction.current = null;
      setFrames((previous) => previous.slice(0, -1));
      setManual(false);
      scroll.current?.scrollTo({ y: 0, animated: false });
    } else setStarted(false);
  };
  const moveNext = () => {
    if (plate) act({ type: 'answer', value: CALIBRATION_NOT_VISIBLE });
    else if (phase === 'edge' || phase === 'contrast') act({ type: 'answer', value: 'not-visible' });
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
  const [pendingAnswer, setPendingAnswer] = useState<{
    frame: typeof state;
    transcript: string;
    match: string;
    choices: string[];
    expected: string;
    step: 'screening' | 'color';
    item: string;
  } | null>(null);
  const answerByVoice = () => {
    if (!plate || disabled || !imageReady || voice.state !== 'idle') return;
    // 권한 확인·녹음 준비를 기다리기 전에 안내 재생부터 즉시 멈춘다.
    stopSpeaking();
    const frame = state;
    setHeard(null);
    voice.startHolding({
      onText: (text) => {
        const match = matchSpokenChoice(text, plate.choices);
        if (match) {
          setPendingAnswer({
            frame,
            transcript: text,
            match,
            choices: [...plate.choices],
            expected: plate.answer,
            step: frame.phase === 'color' ? 'color' : 'screening',
            item: `${frame.phase}-${frame.index}`,
          });
        } else {
          setHeard({ frame, message: text ? `"${text}"(으)로 들었어요. 다시 말해 주세요.` : '잘 들리지 않았어요. 다시 말해 주세요.' });
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

  if (!started) {
    const guides = [
      { ios: 'sun.max.fill', android: 'brightness_6', title: '화면을 편하게 맞춰 주세요', body: '화면 밝기를 평소 보기 편한 정도로 조절하고, 휴대폰을 눈앞의 편한 거리에 놓아 주세요.' },
      { ios: 'mic.fill', android: 'mic', title: '보이는 숫자를 말해 주세요', body: '색점 그림 속 숫자를 음성으로 답하면, 들은 내용을 한 번 더 확인해 드려요.' },
      { ios: 'eye.slash.fill', android: 'visibility_off', title: '안 보이면 그대로 말해 주세요', body: '숫자가 구분되지 않을 때는 “안 보여요”라고 말하면 다음 문제로 이어져요.' },
    ] as const;
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}
      >
        <StatusBar style="light" />
        <View style={styles.header}>
          <View style={styles.headerSide}><BackButton label="소개로" palette={palette} onPress={leaveTest} /></View>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>색각 맞춤 테스트</Text>
          <View style={styles.headerSide} />
        </View>
        <ScrollView contentContainerStyle={styles.guideContent}>
          <View style={styles.guideIntro}>
            <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideHeading, { color: palette.text }]}>테스트 전에 확인해 주세요</Text>
            <Text lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideDescription, { color: palette.textSecondary }]}>{'간단한 문제를 통해 색상과 윤곽선, 대비를\n내 눈에 편하게 맞춰요.'}</Text>
          </View>
          <View style={styles.guideList}>
            {guides.map((guide) => <View key={guide.title} style={[styles.guideCard, { backgroundColor: palette.surface, borderColor: palette.outline }]}
            >
              <View style={[styles.guideIcon, { backgroundColor: palette.fill }]}>
                <SymbolView name={{ ios: guide.ios, android: guide.android, web: guide.android }} size={26} tintColor={palette.highlight} />
              </View>
              <View style={styles.guideTexts}>
                <Text lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideTitle, { color: palette.text }]}>{guide.title}</Text>
                <Text lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideBody, { color: palette.textSecondary }]}>{guide.body}</Text>
              </View>
            </View>)}
          </View>
          <View style={styles.guideButton}><BigButton label="테스트 시작" palette={palette} disabled={disabled} onPress={() => { setStarted(true); scroll.current?.scrollTo({ y: 0, animated: false }); }} /></View>
          <Text lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideNote, { color: palette.textSecondary }]}>{'마이크 권한이 필요하며, 테스트 결과는 화면을 보기 편하게\n조정하는 데 사용돼요.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerSide}><BackButton label="이전 화면으로" palette={palette} onPress={moveBack} /></View>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>색각 맞춤 테스트</Text>
        <View style={styles.headerSide} />
      </View>
      <View style={styles.progressBar}>
        <Text accessibilityRole="header" style={[styles.progressLabel, { color: palette.text }]}>{progress}</Text>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="색각 맞춤 테스트 진행률"
          accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}% 완료` }}
          style={[styles.progressTrack, { backgroundColor: palette.outline }]}
        >
          <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: palette.highlight }]} />
        </View>
        <Text style={[styles.progressPercent, { color: palette.textSecondary }]}>{progressPercent}% 완료</Text>
        <View style={styles.steps}>
          {STEP_DETAILS.map((step, stepIndex) => {
            const active = stepIndex === PHASE_INDEX[phase];
            const complete = stepIndex < PHASE_INDEX[phase];
            return <View key={step.name} style={[styles.stepCard, {
              backgroundColor: active ? palette.highlight : palette.surface,
              borderColor: active || complete ? palette.highlight : palette.outline,
            }]}
            >
              <Text style={[styles.stepName, { color: active ? palette.highlightText : palette.text }]}>{stepIndex + 1}. {step.name}</Text>
              <Text style={[styles.stepCount, { color: active ? palette.highlightText : palette.textSecondary }]}>{step.count}</Text>
            </View>;
          })}
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

        {plate && <PressableScale accessibilityRole="button"
          accessibilityLabel={voice.state === 'recording' ? '듣고 있어요' : voice.state === 'thinking' ? '알아듣는 중' : '음성으로 답하기'}
          accessibilityHint="누른 채로 보이는 숫자를 말하고, 다 말하면 손을 떼 주세요"
          accessibilityState={{ disabled: disabled || !imageReady || voice.state === 'thinking', busy: voice.state === 'thinking' }}
          disabled={disabled || !imageReady || voice.state === 'thinking'}
          onTouchStart={answerByVoice} onTouchEnd={voice.stopHolding} onTouchCancel={voice.stopHolding} onPressOut={voice.stopHolding}
          style={({ pressed }) => [styles.voice, voice.state === 'recording'
            ? { backgroundColor: palette.highlight, borderColor: palette.highlight }
            : { backgroundColor: 'transparent', borderColor: palette.border },
          { opacity: disabled || !imageReady ? 0.4 : pressed ? 0.7 : 1 }]}
        >
          {voice.state === 'thinking' ? <ActivityIndicator color={palette.text} />
            : <SymbolView name={voice.state === 'recording' ? { ios: 'stop.fill', android: 'stop', web: 'stop' } : { ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={22} tintColor={voice.state === 'recording' ? palette.highlightText : palette.text} />}
          <Text style={[styles.voiceText, { color: voice.state === 'recording' ? palette.highlightText : palette.text }]}>
            {voice.state === 'recording' ? '듣고 있어요 · 다 말하면 손을 떼 주세요' : voice.state === 'thinking' ? '알아듣는 중…' : '음성으로 답하기'}
          </Text>
        </PressableScale>}
        {plate && heard?.frame === state && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.note, { color: palette.text }]}>{heard.message}</Text>}
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
        {questionPhase && <View style={styles.questionNav}>
          <BigButton label="이전 문제" selected={false} palette={palette} disabled={disabled || frames.length <= 1} onPress={moveBack} />
          <BigButton label="다음 문제" palette={palette} disabled={disabled || !imageReady} accessibilityHint="현재 그림은 잘 보이지 않는 것으로 기록하고 다음 문제로 이동해요" onPress={moveNext} />
        </View>}
        {questionPhase && <Text style={[styles.navHint, { color: palette.textSecondary }]}>다음 문제를 누르면 현재 그림은 ‘잘 보이지 않음’으로 기록돼요.</Text>}
        {phase === 'complete' && <View style={styles.manual}>
          <Text style={[styles.note, { color: palette.textSecondary }]}>마이페이지에서 언제든 다시 맞출 수 있어요.</Text>
          <View style={styles.buttonRow}><BigButton label={saving ? '저장 중…' : '보정값 확인하기'} palette={palette} disabled={disabled} onPress={() => { void finish(); }} /></View>
        </View>}
        {phase !== 'complete' && <TextButton label="이 단계 건너뛰기" accessibilityHint="지금 단계는 보정 없음으로 두고 다음 단계로 이동해요" palette={palette} disabled={disabled} onPress={() => act({ type: 'skip' })} />}
        {error && <View style={styles.manual}><Text style={[styles.note, { color: palette.textSecondary }]}>기존 설정을 불러오지 못했어요.</Text><View style={styles.buttonRow}><BigButton label="설정 다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View></View>}
      </ScrollView>
      <ConfirmDialog
        visible={pendingAnswer?.frame === state}
        title={pendingAnswer ? `“${pendingAnswer.match}”라고 답하신 게 맞나요?` : ''}
        confirmLabel="네"
        cancelLabel="아니요"
        palette={palette}
        onCancel={() => setPendingAnswer(null)}
        onConfirm={() => {
          if (!pendingAnswer || pendingAnswer.frame !== state) return;
          void saveVoiceAnswer({
            session_id: voiceSessionId,
            step: pendingAnswer.step,
            choices: pendingAnswer.choices,
            transcript: pendingAnswer.transcript,
            choice: pendingAnswer.match,
            expected: pendingAnswer.expected,
            item: pendingAnswer.item,
          }).catch(() => undefined);
          const answer = pendingAnswer.match;
          setPendingAnswer(null);
          act({ type: 'answer', value: answer });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: Spacing.two },
  headerSide: { width: MinTouchTarget, minHeight: MinTouchTarget, justifyContent: 'center' },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  guideContent: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: ScreenPadding, paddingVertical: Spacing.four, gap: Spacing.four },
  guideIntro: { alignItems: 'center', gap: Spacing.two },
  guideHeading: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 800, textAlign: 'center' },
  guideDescription: { fontSize: FontSize.body, lineHeight: 30, textAlign: 'center' },
  guideList: { gap: 12 },
  guideCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderWidth: 1.5, borderRadius: 20 },
  guideIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  guideTexts: { flex: 1, gap: 4 },
  guideTitle: { fontSize: FontSize.label, lineHeight: 26, fontWeight: 800 },
  guideBody: { fontSize: 16, lineHeight: 24 },
  guideButton: { flexDirection: 'row' },
  guideNote: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.four },
  progressBar: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.one, paddingBottom: Spacing.two, gap: Spacing.two },
  progressLabel: { fontSize: FontSize.heading, lineHeight: 34, fontWeight: 800 },
  progressTrack: { width: '100%', height: 16, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8 },
  progressPercent: { marginTop: -Spacing.one, fontSize: 15, lineHeight: 22, fontWeight: 700, textAlign: 'right', fontVariant: ['tabular-nums'] },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stepCard: { flexBasis: '45%', flexGrow: 1, minHeight: 58, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5, borderRadius: 14 },
  stepName: { fontSize: 16, lineHeight: 22, fontWeight: 800 },
  stepCount: { fontSize: 14, lineHeight: 20, fontWeight: 700 },
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
  questionNav: { flexDirection: 'row', gap: Spacing.two },
  navHint: { marginTop: -Spacing.two, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
