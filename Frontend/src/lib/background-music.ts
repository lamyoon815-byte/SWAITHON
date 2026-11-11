/**
 * 해설 음성 뒤에 작게 까는 배경 음악 (분위기 10가지 중 하나, `GET /music/{category}`).
 * - 해설이 재생되면 천천히 커지고(페이드 인), 멈추거나 끝나면 잠깐 뒤 천천히 작아져 멈춘다(페이드 아웃).
 * - 문장 사이처럼 아주 잠깐 끊길 때는 끄지 않는다(LINGER_MS).
 * - 음악은 반복 재생한다. 해설 음성보다 훨씬 작게(MUSIC_VOLUME) 튼다.
 * - 음악을 못 불러와도 해설에는 영향을 주지 않는다. 그 주소는 이번 실행 동안 다시 시도하지 않는다.
 * 화면은 이 클래스를 직접 쓰지 않고 `use-background-music` 훅을 쓴다.
 */

import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

/** 해설 음성(1.0)에 비한 배경 음악 크기 */
export const MUSIC_VOLUME = 0.18;
export const FADE_IN_MS = 1500;
export const FADE_OUT_MS = 2000;
/** 해설이 멈춘 뒤 음악을 이만큼 더 들려준 다음 줄이기 시작한다. */
export const LINGER_MS = 1500;
const STEP_MS = 100;

export class BackgroundMusic {
  private url: string | null = null;
  private active = false;
  private player: AudioPlayer | null = null;
  private subscription: { remove(): void } | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly failed = new Set<string>();

  /** url: 틀 음악(없으면 끔), active: 해설이 재생 중인지. 매번 불러도 바뀐 것만 반영한다. */
  update(url: string | null, active: boolean) {
    if (url !== this.url) {
      this.release();
      this.url = url;
      this.active = false;
    }
    if (active === this.active) return;
    this.active = active;
    if (active) this.start();
    else this.finish();
  }

  /** 화면을 떠날 때. 바로 멈추고 정리한다. */
  dispose() {
    this.release();
    this.url = null;
    this.active = false;
  }

  private start() {
    this.clearLinger();
    const url = this.url;
    if (!url || this.failed.has(url)) return;
    try {
      if (!this.player) {
        const player = createAudioPlayer(url, { updateInterval: 1000 });
        player.loop = true;
        player.volume = 0;
        this.player = player;
        this.subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          if (status.error && this.player === player) {
            this.failed.add(url);
            this.release();
          }
        });
      }
      this.player.play();
      this.fadeTo(MUSIC_VOLUME, FADE_IN_MS);
    } catch {
      this.failed.add(url);
      this.release();
    }
  }

  private finish() {
    if (!this.player) return;
    this.clearLinger();
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      this.fadeTo(0, FADE_OUT_MS, () => this.player?.pause());
    }, LINGER_MS);
  }

  private fadeTo(target: number, duration: number, done?: () => void) {
    this.clearFade();
    const player = this.player;
    if (!player) return;
    const from = player.volume;
    const steps = Math.max(1, Math.round(duration / STEP_MS));
    let step = 0;
    this.fadeTimer = setInterval(() => {
      if (this.player !== player) return this.clearFade();
      step++;
      player.volume = from + (target - from) * Math.min(1, step / steps);
      if (step >= steps) {
        this.clearFade();
        done?.();
      }
    }, STEP_MS);
  }

  private clearFade() {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
  }

  private clearLinger() {
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
  }

  private release() {
    this.clearFade();
    this.clearLinger();
    this.subscription?.remove();
    this.subscription = null;
    const player = this.player;
    this.player = null;
    if (player) {
      try { player.pause(); player.release(); } catch { /* 이미 정리된 플레이어 */ }
    }
  }
}
