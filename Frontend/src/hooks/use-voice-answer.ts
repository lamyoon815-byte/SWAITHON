/**
 * 짧은 음성 답 받기: 누르면 녹음 → 다시 누르거나 6초가 지나면 멈추고 서버(`/transcribe`)로 글자를 받는다.
 * expo-audio 녹음이라 Expo Go에서도 된다. 녹음 전에 안내 음성(expo-speech)을 멈춰 질문이 같이 녹음되지 않게 한다.
 * 화면을 떠나면 녹음을 버린다.
 */

import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, transcribeAnswer } from '@/lib/api';

const MAX_SECONDS = 6;

export type VoiceAnswerState = 'idle' | 'recording' | 'thinking';
type Handlers = { onText: (text: string) => void; onError: (message: string) => void };

export function useVoiceAnswer() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<VoiceAnswerState>('idle');
  const stateRef = useRef<VoiceAnswerState>('idle');
  const handlers = useRef<Handlers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelled = useRef(false);

  const set = (next: VoiceAnswerState) => { stateRef.current = next; setState(next); };

  const finish = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    clearTimeout(timer.current);
    set('thinking');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      if (cancelled.current) return;
      const uri = recorder.uri;
      if (!uri) throw new Error('no recording');
      const text = await transcribeAnswer(uri);
      if (!cancelled.current) handlers.current?.onText(text);
    } catch (error) {
      if (!cancelled.current) {
        handlers.current?.onError(error instanceof ApiError && error.status !== 0 ? error.message : '음성을 알아듣지 못했어요. 다시 말하거나 버튼을 눌러 주세요.');
      }
    } finally {
      if (!cancelled.current) set('idle');
    }
  }, [recorder]);

  const start = useCallback(async (next: Handlers) => {
    if (stateRef.current !== 'idle') return;
    handlers.current = next;
    cancelled.current = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        next.onError('마이크 권한을 허용하면 말로 답할 수 있어요.');
        return;
      }
      await Speech.stop();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      set('recording');
      timer.current = setTimeout(() => { void finish(); }, MAX_SECONDS * 1000);
    } catch {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      set('idle');
      next.onError('녹음을 시작하지 못했어요. 버튼을 눌러 골라 주세요.');
    }
  }, [finish, recorder]);

  /** 녹음 중이면 멈추고 알아듣기, 아니면 녹음 시작. */
  const toggle = useCallback((next: Handlers) => {
    if (stateRef.current === 'recording') void finish();
    else void start(next);
  }, [finish, start]);

  // 화면을 떠나면 녹음과 결과를 버린다.
  useFocusEffect(useCallback(() => () => {
    cancelled.current = true;
    clearTimeout(timer.current);
    if (stateRef.current === 'recording') {
      void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
    set('idle');
  }, [recorder]));
  useEffect(() => () => clearTimeout(timer.current), []);

  return { state, toggle, maxSeconds: MAX_SECONDS };
}
