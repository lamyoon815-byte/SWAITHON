import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { BackgroundMusic } from '@/lib/background-music';

/**
 * 해설이 재생되는 동안 배경 음악을 작게 깐다.
 * url이 없거나 enabled가 false면 틀지 않는다. 화면을 떠나면(다른 화면으로 이동·뒤로 가기) 바로 멈춘다.
 */
export function useBackgroundMusic(url: string | null, active: boolean, enabled: boolean, paused = false, volume?: number) {
  const [music] = useState(() => new BackgroundMusic());
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); music.dispose(); };
  }, [music]));
  useEffect(() => { music.update(enabled && focused ? url : null, active, paused, volume); });
  useEffect(() => () => music.dispose(), [music]);
}
