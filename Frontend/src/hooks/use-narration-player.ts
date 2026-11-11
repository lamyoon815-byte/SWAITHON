import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { NarrationEngine, type NarrationVoice } from '@/lib/narration-engine';

export function useNarrationPlayer(sentences: string[], rate: number, repeat: boolean, voice: NarrationVoice = 'openai') {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine] = useState(() => new NarrationEngine(setIndex, setPlaying, setPreparing, setError));
  useEffect(() => { engine.configure({ sentences, rate, repeat, voice }); });
  useFocusEffect(useCallback(() => () => engine.stop(), [engine]));
  return {
    index, playing, preparing, error,
    play: () => engine.play(), playFrom: (i: number) => engine.speakAt(i),
    pause: () => engine.stop(), goTo: (i: number) => engine.goTo(i),
    reset: () => engine.reset(), changeRate: (r: number) => engine.changeRate(r),
  };
}
