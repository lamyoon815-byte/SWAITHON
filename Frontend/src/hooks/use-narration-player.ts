import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { NarrationEngine } from '@/lib/narration-engine';

/** onComplete: 해설을 마지막 문장까지 끝까지 들었을 때 불린다. */
export function useNarrationPlayer(sentences: string[], rate: number, repeat: boolean, onComplete?: () => void, artworkId?: string) {
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
  useEffect(() => { engine.configure({ sentences, rate, repeat, artworkId }); });
  // 엔진은 한 번만 만들므로 최신 완료 콜백을 매번 넘긴다.
  useEffect(() => { engine.setOnComplete(onComplete); });
  useFocusEffect(useCallback(() => () => engine.stop(), [engine]));
  return {
    index, playing, preparing, paused, error, ...position,
    play: () => engine.play(), playFrom: (i: number) => engine.speakAt(i),
    pause: () => engine.pause(), goTo: (i: number) => engine.goTo(i),
    reset: () => engine.reset(), changeRate: (r: number) => engine.changeRate(r),
  };
}
