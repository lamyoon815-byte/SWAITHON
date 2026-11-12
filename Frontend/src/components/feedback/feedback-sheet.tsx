/**
 * 감상 피드백 팝업. 해설을 끝까지 듣고 홈 화면으로 돌아오면 한 번 뜬다(`lib/pending-feedback`).
 * 저시력 사용자를 위해 글자를 읽고 고르는 단계를 두지 않는다. 누르는 곳은 둘뿐이다.
 * 1) 만족도 큰 버튼 3개 → 2) 누른 채로 말하기(손을 떼면 바로 저장) 또는 "말하지 않고 보내기"
 * → 서버가 의견을 해석해 바로 적용하고, 무엇을 바꿨는지 음성으로 읽은 뒤 팝업이 저절로 닫힌다.
 * 음성 원본은 보내지 않고, 서버가 글자로 바꾼 의견만 저장한다.
 * 안내 음성은 서버가 문장마다 만들어 저장하므로, 제목이나 사용자 말 같은 바뀌는 내용은 읽지 않고
 * 정해진 문장만 한 문장씩 읽는다(처음 한 번만 만들고 그다음부터는 바로 재생된다).
 */

import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BigButton } from '@/components/common/big-button';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { PressableScale } from '@/components/common/pressable-scale';
import { Text } from '@/components/common/text';
import { TextButton } from '@/components/common/text-button';
import { showToast } from '@/components/common/toast';
import { ButtonRadius, FontSize, MinTouchTarget, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import { useVoiceAnswer } from '@/hooks/use-voice-answer';
import { ApiError, type FeedbackResult, type FeedbackSatisfaction } from '@/lib/api';
import type { PendingFeedback } from '@/lib/pending-feedback';
import { speakKorean, stopSpeaking } from '@/lib/speech';
import { getSpeechAudio } from '@/lib/speech-audio';

type Step = 'rate' | 'voice' | 'sending' | 'done';

const CHOICES: { value: FeedbackSatisfaction; label: string }[] = [
  { value: 'good', label: '좋았어요' },
  { value: 'okay', label: '보통이에요' },
  { value: 'bad', label: '아쉬웠어요' },
];

const TITLES: Record<Step, string> = {
  rate: '감상은 어떠셨어요?',
  voice: '더 바라는 점이 있나요?',
  sending: '의견을 살펴보고 있어요',
  done: '의견 고마워요',
};

const RATE_PROMPT = '이번 작품 감상은 어떠셨어요? 좋았어요, 보통이에요, 아쉬웠어요 중에서 골라 주세요.';
const VOICE_PROMPT = '바꾸고 싶은 점이 있으면 말하기 버튼을 누른 채로 말하고, 다 말하면 손을 떼 주세요. 없으면 말하지 않고 보내기를 눌러 주세요.';
/** 결과 안내를 다 읽은 뒤 팝업을 닫기 전 잠깐 기다린다. */
const CLOSE_DELAY_MS = 800;

/** 정해진 문장을 한 문장씩 이어서 읽고, 끝나면(실패해도) finished를 부른다. stopSpeaking()이 남은 문장을 끊는다. */
function speakLines(lines: string[], finished: () => void) {
  const [first, ...rest] = lines.filter(Boolean);
  if (!first) {
    finished();
    return;
  }
  const next = () => speakLines(rest, finished);
  void speakKorean(first, { onDone: next, onError: next });
}

type Props = { item: PendingFeedback; palette: Palette; onClose: () => void };

export function FeedbackSheet({ item, palette, onClose }: Props) {
  const { sendFeedback } = useProfile();
  const voice = useVoiceAnswer('feedback');
  const [step, setStep] = useState<Step>('rate');
  const [satisfaction, setSatisfaction] = useState<FeedbackSatisfaction>('okay');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const sending = step === 'sending';

  useEffect(() => {
    void speakKorean(RATE_PROMPT);
    // 다음 단계 안내를 미리 받아 두어 고르자마자 바로 읽는다.
    void getSpeechAudio(VOICE_PROMPT).catch(() => undefined);
    return () => stopSpeaking();
  }, []);

  const close = () => {
    if (sending) return;
    stopSpeaking();
    onClose();
  };

  const rate = (value: FeedbackSatisfaction) => {
    setSatisfaction(value);
    setStep('voice');
    void speakKorean(VOICE_PROMPT);
  };

  const send = async (comment?: string) => {
    stopSpeaking();
    setStep('sending');
    try {
      const next = await sendFeedback(item.artworkId, satisfaction, comment);
      setResult(next);
      setStep('done');
      if (next.applied.length > 0) showToast('말씀하신 대로 설정을 바꿨어요', 'success');
      // 무엇을 바꿨는지 다 읽어 준 뒤 저절로 닫는다.
      speakLines([next.message, ...next.suggestions.map((suggestion) => suggestion.message)],
        () => setTimeout(onClose, CLOSE_DELAY_MS));
    } catch (error) {
      setStep('voice');
      showToast(error instanceof ApiError && error.status !== 0 ? error.message : '의견을 보내지 못했어요. 다시 시도해 주세요', 'error');
    }
  };

  const listen = () => {
    voice.startHolding({
      onText: (text) => {
        const said = text.trim();
        if (!said) {
          showToast('말씀을 알아듣지 못했어요. 다시 말해 주세요', 'warning');
          return;
        }
        // 확인 단계 없이 바로 저장·적용한다.
        setTranscript(said);
        void send(said);
      },
      onError: (message) => showToast(message, 'error'),
    });
  };

  const listening = voice.state === 'recording';
  const thinking = voice.state === 'thinking';
  const changed = result?.applied.length ? result.suggestions : [];

  return (
    <BottomSheet visible title={TITLES[step]} palette={palette} onClose={close} dismissible={!sending}>
      {step === 'rate' && (
        <>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.body, { color: palette.textSecondary }]}>
            「{item.title}」 해설을 끝까지 들으셨어요.
          </Text>
          <View style={styles.choices}>
            {CHOICES.map((choice) => (
              <BigButton key={choice.value} label={choice.label} palette={palette} onPress={() => rate(choice.value)} />
            ))}
          </View>
          <TextButton label="다음에 할게요" palette={palette} onPress={close} />
        </>
      )}

      {step === 'voice' && (
        <>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={listening ? '듣고 있어요. 다 말하면 손을 떼 주세요' : '누른 채로 말하기'}
            accessibilityHint="누르고 있는 동안 녹음하고, 손을 떼면 바로 반영해요"
            accessibilityState={{ disabled: thinking, busy: thinking }}
            disabled={thinking}
            onPressIn={listen}
            onPressOut={voice.stopHolding}
            style={[styles.talk, { backgroundColor: listening ? palette.highlight : palette.fill, borderColor: palette.outline }]}>
            <View accessible={false} importantForAccessibility="no-hide-descendants">
              <SymbolView name={{ ios: listening ? 'waveform' : 'mic.fill', android: listening ? 'graphic_eq' : 'mic', web: 'mic' }}
                size={36} tintColor={listening ? palette.highlightText : palette.text} />
            </View>
            <Text style={[styles.talkLabel, { color: listening ? palette.highlightText : palette.text }]}>
              {listening ? '듣고 있어요…' : thinking ? '알아듣는 중…' : '누른 채로 말하기'}
            </Text>
          </PressableScale>
          <TextButton label="말하지 않고 보내기" palette={palette} disabled={listening || thinking} onPress={() => { void send(); }} />
        </>
      )}

      {sending && (
        <View accessibilityLiveRegion="polite" style={styles.busy}>
          <ActivityIndicator size="large" color={palette.text} />
          {!!transcript && (
            <Text lineBreakStrategyIOS="hangul-word" style={[styles.body, { color: palette.text, textAlign: 'center' }]}>
              “{transcript}”
            </Text>
          )}
        </View>
      )}

      {step === 'done' && result && (
        <>
          <Text accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.big, { color: palette.text }]}>
            {result.message}
          </Text>
          {changed.map((suggestion) => (
            <View key={suggestion.field} style={[styles.changed, { borderColor: palette.outline }]}>
              <View accessible={false} importantForAccessibility="no-hide-descendants">
                <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={26} tintColor={palette.highlight} />
              </View>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.body, styles.changedText, { color: palette.text }]}>{suggestion.message}</Text>
            </View>
          ))}
          <BigButton label="닫기" palette={palette} onPress={close} />
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: FontSize.body, lineHeight: 28 },
  big: { fontSize: FontSize.heading, lineHeight: 34, fontWeight: 700 },
  choices: { gap: Spacing.two },
  talk: {
    minHeight: MinTouchTarget * 2.2, borderRadius: ButtonRadius, borderWidth: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 16,
  },
  talkLabel: { fontSize: FontSize.heading, fontWeight: 800 },
  busy: { alignItems: 'center', gap: 16, paddingVertical: Spacing.four },
  changed: { borderWidth: 1.5, borderRadius: ButtonRadius, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  changedText: { flex: 1, fontWeight: 600 },
});
