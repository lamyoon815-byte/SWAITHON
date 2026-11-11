/**
 * Spike: expo-speech Korean voice, rate control, repeat, and interaction with VoiceOver/TalkBack.
 */

import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { BigButton } from '@/components/common/big-button';
import { InfoText, Row, Section } from '@/components/spike/section';
import type { Palette } from '@/constants/a11y';

const SAMPLE_TEXT =
  '빈센트 반 고흐의 별이 빛나는 밤입니다. 화면 위쪽 대부분을 짙은 파란 밤하늘이 채우고, ' +
  '노란 별과 달이 소용돌이치듯 빛나요. 왼쪽 앞에는 검은 사이프러스 나무가 불꽃처럼 솟아 있고, ' +
  '오른쪽 아래에는 작은 마을이 조용히 잠들어 있어요.';

const RATES = [0.75, 1, 1.25, 1.5];

export function TtsPanel({ palette }: { palette: Palette }) {
  const [koVoices, setKoVoices] = useState<Speech.Voice[] | null>(null);
  const [rate, setRate] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [plays, setPlays] = useState(0);
  const [log, setLog] = useState('');
  // onDone closes over the render that started playback, so it reads repeat through a ref.
  const repeatRef = useRef(repeat);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((voices) => setKoVoices(voices.filter((v) => v.language.toLowerCase().startsWith('ko'))))
      .catch((e: Error) => setLog(`음성 목록 오류: ${e.message}`));
    return () => {
      Speech.stop();
    };
  }, []);

  /** @param startedAt set on the first play to log start latency; null on repeats */
  const speak = (rateToUse: number, startedAt: number | null) => {
    Speech.speak(SAMPLE_TEXT, { language: 'ko-KR',
      rate: rateToUse,
      onStart: () => {
        setSpeaking(true);
        if (startedAt !== null) setLog(`시작까지 ${Math.round(performance.now() - startedAt)}ms`);
      },
      onDone: () => {
        setPlays((n) => n + 1);
        if (repeatRef.current) {
          speak(rateToUse, null);
        } else {
          setSpeaking(false);
        }
      },
      onStopped: () => setSpeaking(false),
      onError: (e) => {
        setSpeaking(false);
        setLog(`재생 오류: ${e.message}`);
      },
    });
  };

  const play = async () => {
    const startedAt = performance.now();
    await Speech.stop();
    speak(rate, startedAt);
  };

  const stop = () => {
    setRepeat(false);
    Speech.stop();
  };

  const voiceSummary =
    koVoices === null
      ? '확인 중…'
      : koVoices.length === 0
        ? Platform.OS === 'android'
          ? '없음 — 설정 > 텍스트 음성 변환에서 한국어 음성 데이터 설치 필요'
          : '없음 — 설정 > 손쉬운 사용 > 읽기 및 말하기 > 음성에서 한국어 추가'
        : `${koVoices.length}개 (${koVoices
            .slice(0, 3)
            .map((v) => `${v.name}${v.quality === Speech.VoiceQuality.Enhanced ? '★' : ''}`)
            .join(', ')})`;

  return (
    <Section title="3. 음성 해설 (expo-speech)" palette={palette}>
      <InfoText palette={palette}>한국어 음성: {voiceSummary}</InfoText>
      {Platform.OS === 'ios' && (
        <InfoText palette={palette}>iOS 실기기는 무음 모드면 소리가 나지 않습니다.</InfoText>
      )}
      <Row>
        <BigButton label={speaking ? '처음부터' : '해설 듣기'} onPress={play} palette={palette} />
        <BigButton label="정지" onPress={stop} palette={palette} selected={false} disabled={!speaking} />
      </Row>
      <InfoText palette={palette}>속도 (바꾼 뒤 다시 재생)</InfoText>
      <Row>
        {RATES.map((r) => (
          <BigButton
            key={r}
            label={`${r}x`}
            onPress={() => setRate(r)}
            palette={palette}
            selected={rate === r}
          />
        ))}
      </Row>
      <Row>
        <BigButton
          label={repeat ? '반복 켜짐' : '반복 꺼짐'}
          onPress={() => setRepeat((v) => !v)}
          palette={palette}
          selected={repeat}
        />
      </Row>
      <Row>
        <BigButton
          label="스크린리더로 읽기"
          onPress={() => AccessibilityInfo.announceForAccessibility(SAMPLE_TEXT)}
          palette={palette}
          selected={false}
          accessibilityHint="TTS 대신 VoiceOver나 TalkBack 음성으로 해설을 읽습니다"
        />
      </Row>
      <InfoText palette={palette}>
        재생 완료 {plays}회{log ? ` · ${log}` : ''}
      </InfoText>
    </Section>
  );
}
