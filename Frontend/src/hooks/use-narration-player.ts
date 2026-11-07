/**
 * 해설을 한 문장씩 읽는 재생기 (README 6.2). expo-speech는 문장 하나를 다 읽으면 `onDone`을 부르고,
 * 그때 다음 문장(또는 "이 문장 반복"이면 같은 문장)을 읽는다.
 * 일시정지는 Android에 없어서(`Speech.pause`는 iOS·웹 전용) 멈춘 뒤 그 문장 처음부터 다시 읽는다.
 * 화면을 떠나면(탭 전환, 뒤로) 바로 멈춘다.
 */

import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';

import { speakKorean } from '@/lib/speech';

type Config = { sentences: string[]; rate: number; repeat: boolean };

/** 화면 상태(React)와 따로 도는 말하기 엔진. 지금 값은 `configure`로 받는다. */
class Engine {
  private token = 0;
  private config: Config = { sentences: [], rate: 1, repeat: false };
  private current = 0;
  private speaking = false;

  constructor(
    private readonly onIndex: (i: number) => void,
    private readonly onPlaying: (on: boolean) => void,
  ) {}

  configure(config: Config) {
    this.config = config;
  }

  speakAt(i: number) {
    const text = this.config.sentences[i];
    if (!text) return;
    // Every utterance gets a new token; callbacks from an older one (stopped, skipped) are ignored.
    const mine = ++this.token;
    this.current = i;
    this.speaking = true;
    this.onIndex(i);
    this.onPlaying(true);
    void Speech.stop().then(() => {
      if (mine !== this.token) return;
      void speakKorean(text, {
        rate: this.config.rate,
        onDone: () => {
          if (mine !== this.token) return;
          if (this.config.repeat) this.speakAt(i);
          else if (i + 1 < this.config.sentences.length) this.speakAt(i + 1);
          else {
            this.speaking = false;
            this.current = 0;
            this.onPlaying(false);
            this.onIndex(0);
          }
        },
        onError: () => {
          if (mine === this.token) this.stop();
        },
      });
    });
  }

  stop() {
    this.token++;
    this.speaking = false;
    this.onPlaying(false);
    void Speech.stop();
  }

  /** 듣는 범위가 바뀌었을 때: 멈추고 첫 문장으로 */
  reset() {
    this.stop();
    this.current = 0;
    this.onIndex(0);
  }

  /** 속도가 바뀌면 지금 문장부터 새 속도로 다시 읽는다 (다음 문장까지 기다리지 않게) */
  changeRate(rate: number) {
    this.config = { ...this.config, rate };
    if (this.speaking) this.speakAt(this.current);
  }

  goTo(i: number) {
    const next = Math.max(0, Math.min(this.config.sentences.length - 1, i));
    if (this.speaking) this.speakAt(next);
    else {
      this.current = next;
      this.onIndex(next);
    }
  }

  play() {
    this.speakAt(this.current);
  }
}

export function useNarrationPlayer(sentences: string[], rate: number, repeat: boolean) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [engine] = useState(() => new Engine(setIndex, setPlaying));

  useEffect(() => {
    engine.configure({ sentences, rate, repeat });
  });

  useFocusEffect(useCallback(() => () => engine.stop(), [engine]));

  return {
    index,
    playing,
    play: () => engine.play(),
    playFrom: (i: number) => engine.speakAt(i),
    pause: () => engine.stop(),
    goTo: (i: number) => engine.goTo(i),
    reset: () => engine.reset(),
    changeRate: (r: number) => engine.changeRate(r),
  };
}
