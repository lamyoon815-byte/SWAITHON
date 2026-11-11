import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';

import { speakKorean, stopSpeaking } from '@/lib/speech';

/** 안내는 화면에 머무는 동안만 읽고, 스크린리더 음성과 겹치지 않게 한다. */
export function useSpeech(message: string) {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const announce = async () => {
        const screenReader = await AccessibilityInfo.isScreenReaderEnabled();
        if (!active) return;
        if (screenReader) {
          AccessibilityInfo.announceForAccessibility(message);
          return;
        }
        await speakKorean(message);
      };
      void announce().catch(() => {});
      return () => {
        active = false;
        stopSpeaking();
      };
    }, [message]),
  );
}
