/**
 * 한국어 안내 음성. 앱의 모든 음성은 서버 `/speech`가 만든 GPT 음성(OpenAI)으로 재생한다.
 * 같은 문장은 서버 DB와 기기 캐시에 저장되므로 두 번째부터는 바로 재생된다.
 * 한 번에 하나의 안내만 재생하고, 새 안내나 stopSpeaking()이 이전 안내를 끊는다.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Speech from 'expo-speech';

import { getSpeechAudio } from '@/lib/speech-audio';

type Options = { rate?: number; onDone?: () => void; onError?: () => void };

let token = 0;
let player: AudioPlayer | null = null;
let subscription: { remove(): void } | null = null;

function release() {
  subscription?.remove();
  subscription = null;
  if (player) {
    player.pause();
    player.release();
    player = null;
  }
}

/** 재생 중이거나 준비 중인 안내 음성을 멈춘다. 늦게 도착한 음성도 재생되지 않는다. */
export function stopSpeaking() {
  token++;
  release();
  void Speech.stop();
}

export async function speakKorean(text: string, { rate = 1, onDone, onError }: Options = {}) {
  const mine = ++token;
  release();
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false, interruptionMode: 'duckOthers' });
    const uri = await getSpeechAudio(text);
    if (mine !== token) return;
    const audio = createAudioPlayer(uri, { updateInterval: 100 });
    player = audio;
    let started = false;
    const changed = (status: AudioStatus) => {
      if (mine !== token) return;
      if (status.error) {
        release();
        onError?.();
      } else if (status.didJustFinish) {
        release();
        onDone?.();
      } else if (status.isLoaded && !started) {
        started = true;
        audio.shouldCorrectPitch = true;
        audio.setPlaybackRate(rate, 'high');
        audio.play();
      }
    };
    subscription = audio.addListener('playbackStatusUpdate', changed);
    changed(audio.currentStatus);
  } catch {
    if (mine !== token) return;
    // The AI voice failed (daily limits, network): read it with the phone's Korean voice instead of staying silent.
    Speech.speak(text, {
      language: 'ko-KR', rate,
      onDone: () => { if (mine === token) onDone?.(); },
      onError: () => { if (mine === token) onError?.(); },
    });
  }
}
