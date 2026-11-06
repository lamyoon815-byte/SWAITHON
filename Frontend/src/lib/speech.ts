/**
 * 한국어 음성 해설. expo-speech는 기기에 깔린 OS 음성(iOS AVSpeechSynthesizer, Android TTS 엔진)을 쓴다.
 * 기본값은 저품질(compact) 음성이 잡히는 경우가 많아서, 설치된 한국어 음성 중 가장 좋은 것을 고른다.
 * iOS: 설정 > 손쉬운 사용 > 콘텐츠 말하기 > 음성 > 한국어에서 "향상된/프리미엄" 음성을 내려받으면 그 음성을 쓴다.
 */

import * as Speech from 'expo-speech';

let best: Promise<string | undefined> | null = null;

function rank(v: Speech.Voice) {
  const id = v.identifier.toLowerCase();
  if (id.includes('premium')) return 3;
  if (v.quality === Speech.VoiceQuality.Enhanced || id.includes('enhanced')) return 2;
  if (id.includes('compact')) return 0;
  return 1;
}

/** 설치된 한국어 음성 중 가장 품질이 좋은 음성 id. 없으면 undefined(시스템 기본). */
export function bestKoreanVoice() {
  best ??= Speech.getAvailableVoicesAsync()
    .then((voices) =>
      voices
        .filter((v) => v.language.toLowerCase().startsWith('ko'))
        .sort((a, b) => rank(b) - rank(a))[0]?.identifier,
    )
    .catch(() => undefined);
  return best;
}

export async function speakKorean(text: string, options: Speech.SpeechOptions = {}) {
  const voice = await bestKoreanVoice();
  Speech.speak(text, { language: 'ko-KR', ...options, ...(voice ? { voice } : {}) });
}
