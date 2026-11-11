// 와이어프레임 6: AI 자료 기반 화면 맞추기 (숫자 선택 → 색 보정 → 윤곽선 → 대비).
import { Image } from 'expo-image';
import { router, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { CALIBRATION, CALIBRATION_NOT_VISIBLE, type CalibrationPlate } from '@/assets/images/calibration';
import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
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
import { matchSpokenChoice, spokenNumbers, spokenYesNo } from '@/lib/spoken-answer';
import { stopSpeaking } from '@/lib/speech';
import { advanceCalibration, initialCalibration, type CalibrationAction } from '@/lib/calibration-flow';
import { CALIBRATION_COLOR_LABELS } from '@/types/calibration';

const FOUND_MASCOT = require('@/assets/images/mascot/found.png');

/** 결과가 애매할 때 비교해 보여 줄 보정 종류(같은 순서로 그림 1·2·3). 이름 대신 그림으로 고른다. */
const COMPARE_TYPES = ['protan', 'deutan', 'tritan'] as const;

export default function CalibrationScreen() {
  const { profile, loaded, error, saveCalibration, reloadProfile } = useProfile();
  const { loaded: settingsLoaded, finishOnboarding } = useSettings();
  const palette = getPalette('dark', profile.high_contrast);
  const [started, setStarted] = useState(false);
  const [frames, setFrames] = useState(() => [initialCalibration()]);
  const [saving, setSaving] = useState(false);
  const [readySource, setReadySource] = useState<number | null>(null);
  const [failedSource, setFailedSource] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(0);
  const lastAction = useRef<(typeof frames)[number] | null>(null);
  const savingLock = useRef(false);
  const state = frames[frames.length - 1];
  const { phase, index, result } = state;
  const disabled = !loaded || !settingsLoaded || error || saving;
  const plate: CalibrationPlate | undefined = phase === 'screening' ? CALIBRATION.screening.plates[index]
    : phase === 'color' && result.color_type !== 'normal' ? CALIBRATION.color[result.color_type].plates[index] : undefined;
  const source = plate?.image ?? (phase === 'edge' ? CALIBRATION.edge.images[index] : undefined);
  const imageReady = source === undefined || (readySource === source && failedSource !== source);
  const colorLevels = CALIBRATION.color[result.color_type === 'normal' ? 'protan' : result.color_type].levels;
  const progress = phase === 'screening' ? `색각 확인 문제 ${index + 1} / ${CALIBRATION.screening.plates.length}`
    : phase === 'manual' ? '색각 확인 결과' : phase === 'color' ? `색 보정 · 문제 ${index + 1} / ${colorLevels.length}`
      : phase === 'edge' ? `윤곽선 · 문제 ${index + 1} / ${CALIBRATION.edge.levels.length}`
        : phase === 'contrast' ? `대비 · 문제 ${index + 1} / ${CALIBRATION.contrast.levels.length}` : '맞춤 보정 테스트 완료';
  const progressRatio = phase === 'screening' ? (index / CALIBRATION.screening.plates.length) * 0.25
    : phase === 'manual' ? 0.25
      : phase === 'color' ? 0.25 + (index / colorLevels.length) * 0.25
        : phase === 'edge' ? 0.5 + (index / CALIBRATION.edge.levels.length) * 0.25
          : phase === 'contrast' ? 0.75 + (index / CALIBRATION.contrast.levels.length) * 0.25 : 1;
  const progressPercent = Math.round(progressRatio * 100);
  const question = plate ? '어떤 숫자가 보이나요?' : phase === 'manual' ? '가장 또렷한 그림을 골라 주세요'
    : phase === 'edge' ? '윤곽선이 또렷하게 보이나요?' : phase === 'contrast' ? '밝은 부분이 구분되나요?' : '보기 설정을 찾았어요';
  const description = plate ? '그림 속 숫자를 음성으로 말해 주세요. 숫자가 보이지 않으면 “안 보여요”라고 말해 주세요.' : phase === 'manual' ? '같은 검사판을 서로 다르게 보정했어요. 숫자가 가장 잘 보이는 그림을 눌러 주세요. 색 이름은 몰라도 괜찮아요.'
    : phase === 'edge' ? CALIBRATION.edge.question : phase === 'contrast'
      ? `같은 그림에서 대비만 단계별로 높이고 있어요. 흰 옷과 뒤쪽 흰 커튼의 경계를 비교해 주세요. 현재 대비 ${CALIBRATION.contrast.levels[index].toFixed(1)}배예요.`
      : '설정을 확인하고 감상을 시작해 보세요.';
  const questionPhase = phase === 'screening' || phase === 'color' || phase === 'edge' || phase === 'contrast';
  const introSpeech = '맞춤 보정 테스트를 시작하기 전에 안내해 드릴게요. 화면 밝기를 편하게 맞추고, 그림 속 숫자를 음성으로 답해 주세요. 숫자가 보이지 않으면 안 보여요라고 말하면 돼요.';
  useSpeech(started ? `${question} ${description}` : introSpeech);

  const leaveTest = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/onboarding');
  };

  const moveBack = () => {
    if (savingLock.current) return;
    if (frames.length > 1) {
      lastAction.current = null;
      setFrames((previous) => previous.slice(0, -1));
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
    /** 확인 창에 보여 주고 답으로 넘길 값. 보기에 없는 숫자도 그대로(오답으로 기록된다). */
    match: string;
    /** 서버 기록용 보기. 보기에 없는 숫자를 말했으면 null. */
    choice: string | null;
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
        const picked = matchSpokenChoice(text, plate.choices);
        // 보기에 없는 숫자("18")도 다시 말하라고 하지 않고, 그 숫자로 답한 게 맞는지 물은 뒤 오답으로 넘긴다.
        const match = picked ?? spokenNumbers(text)[0] ?? null;
        if (match) {
          setPendingAnswer({
            frame,
            transcript: text,
            match,
            choice: picked,
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
  const [confirmHeard, setConfirmHeard] = useState<string | null>(null);
  const confirmPending = () => {
    if (!pendingAnswer || pendingAnswer.frame !== state) return;
    void saveVoiceAnswer({
      session_id: voiceSessionId,
      step: pendingAnswer.step,
      choices: pendingAnswer.choices,
      transcript: pendingAnswer.transcript,
      choice: pendingAnswer.choice,
      expected: pendingAnswer.expected,
      item: pendingAnswer.item,
    }).catch(() => undefined);
    // 보기에 없는 숫자는 흐름이 받지 않으므로 "숫자가 안 보여요"(오답)로 넘긴다.
    const answer = pendingAnswer.choice ?? CALIBRATION_NOT_VISIBLE;
    setPendingAnswer(null);
    setConfirmHeard(null);
    act({ type: 'answer', value: answer });
  };
  // 확인 창에서 "맞아요"라고 하면 그 답으로 다음 문제로, "아니요"면 창을 닫고 다시 답하게 한다.
  const confirmByVoice = () => {
    if (!pendingAnswer || voice.state !== 'idle') return;
    stopSpeaking();
    setConfirmHeard(null);
    voice.startHolding({
      onText: (text) => {
        const reply = spokenYesNo(text);
        if (reply === 'yes') confirmPending();
        else if (reply === 'no') { setPendingAnswer(null); setConfirmHeard(null); }
        else setConfirmHeard(text ? `"${text}"(으)로 들었어요. 맞아요 또는 아니요라고 말해 주세요.` : '잘 들리지 않았어요. 맞아요 또는 아니요라고 말해 주세요.');
      },
      onError: (message) => setConfirmHeard(message),
    });
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
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>맞춤 보정 테스트</Text>
          <View style={styles.headerSide} />
        </View>
        <ScrollView contentContainerStyle={styles.guideContent}>
          <View style={styles.guideIntro}>
            <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality" style={[styles.guideHeading, { color: palette.highlight }]}>테스트 전에 확인해 주세요</Text>
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
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerSide}><BackButton label="이전 화면으로" palette={palette} onPress={moveBack} /></View>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>맞춤 보정 테스트</Text>
        <View style={styles.headerSide} />
      </View>
      {phase !== 'complete' && <View style={styles.progressBar}>
        <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" android_hyphenationFrequency="none" textBreakStrategy="highQuality"
          style={[styles.progressLabel, { color: palette.text }]}>{progress}</Text>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="맞춤 보정 테스트 진행률"
          accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}% 완료` }}
          style={[styles.progressTrack, { backgroundColor: palette.outline }]}
        >
          <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: palette.highlight }]} />
        </View>
        <Text style={[styles.progressPercent, { color: palette.textSecondary }]}>{progressPercent}% 완료</Text>
      </View>}
      {/* 위 진행 표시는 고정하고, 그 아래로 스크롤되는 내용은 점점 흐려지며 사라진다. */}
      <View style={styles.scrollArea}>
      <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: (questionPhase || phase === 'complete' ? barHeight : insets.bottom) + Spacing.four }]}>
        {phase !== 'complete' && <View style={styles.intro}>
          <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.heading, { color: palette.highlight }]}>{question}</Text>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>
        </View>}

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
          {COMPARE_TYPES.map((type, i) => (
            <PressableScale key={type} accessibilityRole="button" accessibilityLabel={`그림 ${i + 1}`} accessibilityHint="이 그림이 가장 잘 보이면 눌러 주세요"
              accessibilityState={{ disabled }} disabled={disabled} onPress={() => act({ type: 'choose', value: type })}
              style={({ pressed }) => [styles.compareCard, { backgroundColor: palette.surface, borderColor: pressed ? palette.highlight : palette.outline }]}>
              <Image source={CALIBRATION.preview[type].plate[CALIBRATION.preview[type].plate.length - 1]} contentFit="contain" transition={0} style={styles.compareImage} />
              <Text style={[styles.compareLabel, { color: palette.text }]}>그림 {i + 1}</Text>
            </PressableScale>
          ))}
          <View style={styles.buttonRow}><BigButton label="다 비슷해요" selected={false} palette={palette} disabled={disabled}
            accessibilityHint="색 보정 없이 다음 단계로 가요. 마이페이지에서 나중에 바꿀 수 있어요" onPress={() => act({ type: 'choose', value: 'normal' })} /></View>
        </View>}
        {(phase === 'edge' || phase === 'contrast') && <View style={styles.manual}>
          <View style={styles.buttonRow}><BigButton label="잘 보여요" palette={palette} disabled={disabled || !imageReady || (phase === 'contrast' && Platform.OS === 'web')} onPress={() => act({ type: 'answer', value: 'visible' })} /></View>
          <View style={styles.buttonRow}><BigButton label="아직 잘 안 보여요" selected={false} palette={palette} disabled={disabled || !imageReady || (phase === 'contrast' && Platform.OS === 'web')} onPress={() => act({ type: 'answer', value: 'not-visible' })} /></View>
          {phase === 'contrast' && Platform.OS === 'web' && <Text style={[styles.note, { color: palette.textSecondary }]}>대비 맞추기는 휴대폰에서 진행해 주세요. 웹에서는 아래 「이 단계 건너뛰기」로 기본값을 사용할 수 있어요.</Text>}
        </View>}
        {/* 결과 화면: 성격 유형 검사 결과처럼 캐릭터와 내 보기 설정을 크게 보여 준다. */}
        {phase === 'complete' && <View style={styles.result}>
          <Image source={FOUND_MASCOT} contentFit="contain" style={styles.resultMascot} accessible accessibilityLabel="돋보기를 든 카멜레온 캐릭터" />
          <Text style={[styles.resultEyebrow, { color: palette.textSecondary }]}>나에게 맞는 보기 설정</Text>
          <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.resultTitle, { color: palette.highlight }]}>{question}</Text>
          <View style={styles.resultRows}>
            {[
              { name: '색 보정', value: result.color_type === 'normal' || result.severity === 0 ? '필요 없어요' : `${CALIBRATION_COLOR_LABELS[result.color_type]} ${Math.round(result.severity * 100)}%` },
              { name: '윤곽선 강조', value: result.edge === 0 ? '그대로' : `${Math.round(result.edge * 100)}%` },
              { name: '대비', value: result.contrast === 1 ? '그대로' : `${result.contrast.toFixed(1)}배` },
            ].map((row) => (
              <View key={row.name} accessible accessibilityLabel={`${row.name}, ${row.value}`} style={[styles.resultRow, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
                <Text style={[styles.resultName, { color: palette.textSecondary }]}>{row.name}</Text>
                <Text style={[styles.resultValue, { color: palette.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>}
        {phase === 'complete' && <Text style={[styles.resultNote, { color: palette.textSecondary }]}>마이페이지에서 언제든 다시 맞출 수 있어요.</Text>}
        {phase !== 'complete' && <TextButton label="이 단계 건너뛰기" accessibilityHint="지금 단계는 보정 없음으로 두고 다음 단계로 이동해요" palette={palette} disabled={disabled} onPress={() => act({ type: 'skip' })} />}
        {error && <View style={styles.manual}><Text style={[styles.note, { color: palette.textSecondary }]}>기존 설정을 불러오지 못했어요.</Text><View style={styles.buttonRow}><BigButton label="설정 다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View></View>}
      </ScrollView>
      <View pointerEvents="none" style={[styles.topFade, { experimental_backgroundImage: `linear-gradient(180deg, ${palette.background} 0%, ${palette.background}00 100%)` }]} />
      </View>
      {/* 이전·다음 문제는 다른 화면처럼 아래에 고정한다(위쪽 페이드로 내용이 버튼 뒤로 사라진다). */}
      {questionPhase && <BottomActionBar background={palette.background} onHeight={setBarHeight}>
        <View style={styles.questionNav}>
          <BigButton label="이전 문제" selected={false} palette={palette} disabled={disabled || frames.length <= 1} onPress={moveBack} />
          <BigButton label="다음 문제" palette={palette} disabled={disabled || !imageReady} accessibilityHint="현재 그림은 잘 보이지 않는 것으로 기록하고 다음 문제로 이동해요" onPress={moveNext} />
        </View>
        <Text style={[styles.navHint, { color: palette.textSecondary }]}>다음 문제를 누르면 현재 그림은 ‘잘 보이지 않음’으로 기록돼요.</Text>
      </BottomActionBar>}
      {/* 결과 화면의 보정값 확인하기도 문제 화면처럼 아래에 고정한다. */}
      {phase === 'complete' && <BottomActionBar background={palette.background} onHeight={setBarHeight}>
        <View style={styles.buttonRow}><BigButton label={saving ? '저장 중…' : '보정값 확인하기'} palette={palette} disabled={disabled} onPress={() => { void finish(); }} /></View>
      </BottomActionBar>}
      <ConfirmDialog
        visible={pendingAnswer?.frame === state}
        title={pendingAnswer ? `“${pendingAnswer.match}”라고 답하신 게 맞나요?` : ''}
        confirmLabel="네"
        cancelLabel="아니요"
        palette={palette}
        onCancel={() => { setPendingAnswer(null); setConfirmHeard(null); }}
        onConfirm={confirmPending}
      >
        {/* 확인 창 안에서도 "맞아요 / 아니요"를 말로 답할 수 있다(창이 화면 마이크 버튼을 가리므로). */}
        <PressableScale accessibilityRole="button"
          accessibilityLabel={voice.state === 'recording' ? '듣고 있어요' : voice.state === 'thinking' ? '알아듣는 중' : '말로 답하기'}
          accessibilityHint="누른 채로 맞아요 또는 아니요라고 말하고, 다 말하면 손을 떼 주세요"
          accessibilityState={{ disabled: voice.state === 'thinking', busy: voice.state === 'thinking' }}
          disabled={voice.state === 'thinking'}
          onTouchStart={confirmByVoice} onTouchEnd={voice.stopHolding} onTouchCancel={voice.stopHolding} onPressOut={voice.stopHolding}
          style={({ pressed }) => [styles.voice, voice.state === 'recording'
            ? { backgroundColor: palette.highlight, borderColor: palette.highlight }
            : { backgroundColor: 'transparent', borderColor: palette.border },
          { opacity: pressed ? 0.7 : 1 }]}
        >
          {voice.state === 'thinking' ? <ActivityIndicator color={palette.text} />
            : <SymbolView name={voice.state === 'recording' ? { ios: 'stop.fill', android: 'stop', web: 'stop' } : { ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={22} tintColor={voice.state === 'recording' ? palette.highlightText : palette.text} />}
          <Text style={[styles.voiceText, { color: voice.state === 'recording' ? palette.highlightText : palette.text }]}>
            {voice.state === 'recording' ? '듣고 있어요 · 다 말하면 손을 떼 주세요' : voice.state === 'thinking' ? '알아듣는 중…' : '말로 답하기 (맞아요 / 아니요)'}
          </Text>
        </PressableScale>
        {!!confirmHeard && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.note, { color: palette.text }]}>{confirmHeard}</Text>}
      </ConfirmDialog>
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
  progressTrack: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressPercent: { marginTop: -Spacing.one, fontSize: 15, lineHeight: 22, fontWeight: 700, textAlign: 'right', fontVariant: ['tabular-nums'] },
  intro: { gap: Spacing.two, alignItems: 'center' },
  result: { alignItems: 'center', gap: Spacing.two },
  resultMascot: { width: '78%', maxWidth: 320, aspectRatio: 1 },
  resultEyebrow: { fontSize: FontSize.label, fontWeight: 700 },
  resultTitle: { fontSize: 34, lineHeight: 44, fontWeight: 800, textAlign: 'center' },
  resultRows: { alignSelf: 'stretch', gap: 12, marginTop: Spacing.two },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, minHeight: 72, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderWidth: 1.5, borderRadius: 20 },
  resultName: { fontSize: FontSize.body, fontWeight: 700 },
  resultValue: { flexShrink: 1, fontSize: FontSize.heading, fontWeight: 800, textAlign: 'right' },
  resultNote: { fontSize: FontSize.label, lineHeight: 27, textAlign: 'center' },
  heading: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 700, textAlign: 'center' },
  description: { fontSize: FontSize.body, lineHeight: 30, textAlign: 'center' },
  picture: { width: '100%', aspectRatio: 1, padding: Spacing.three, borderWidth: 1.5, borderRadius: 24, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageState: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.three, gap: Spacing.three },
  contrastPicture: { height: 300, borderRadius: 24, borderWidth: 1.5 },
  voice: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 2, borderRadius: ButtonRadius, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  voiceText: { flexShrink: 1, fontSize: FontSize.label, fontWeight: 700, textAlign: 'center' },
  note: { fontSize: FontSize.label, lineHeight: 27, textAlign: 'center' },
  manual: { gap: 12 },
  compareCard: { alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderWidth: 2, borderRadius: 24 },
  compareImage: { width: '100%', aspectRatio: 1 },
  compareLabel: { fontSize: FontSize.label, fontWeight: 800 },
  buttonRow: { flexDirection: 'row' },
  questionNav: { flexDirection: 'row', gap: Spacing.two },
  navHint: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  scrollArea: { flex: 1 },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
});
