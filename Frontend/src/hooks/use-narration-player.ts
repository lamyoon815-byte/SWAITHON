import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { NarrationEngine } from '@/lib/narration-engine';

export function useNarrationPlayer(sentences: string[], rate: number, repeat: boolean) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ currentTime: 0, duration: 0 });
  const [engine] = useState(() => new NarrationEngine(
    setIndex, setPlaying, setPreparing, setError, setPaused,
    (currentTime, duration) => setPosition({ currentTime, duration }),
  ));
  useEffect(() => { engine.configure({ sentences, rate, repeat }); });
  useFocusEffect(useCallback(() => () => engine.stop(), [engine]));
  return {
    index, playing, preparing, paused, error, ...position,
    play: () => engine.play(), playFrom: (i: number) => engine.speakAt(i),
    pause: () => engine.pause(), goTo: (i: number) => engine.goTo(i),
    reset: () => engine.reset(), changeRate: (r: number) => engine.changeRate(r),
  };
}
