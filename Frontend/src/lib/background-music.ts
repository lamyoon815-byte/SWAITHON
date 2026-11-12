/**
 * 해설 음성 뒤에 작게 까는 배경 음악 (분위기 10가지 × 잔잔한 곡/움직임 있는 곡, `GET /music/{category}/{energy}`).
 * - 곡이 정해지면 미리 받아 두고(소리는 내지 않음), 해설 음성이 나오는 순간 함께 시작해 짧게 커진다.
 *   멈추거나 끝나면 잠깐 뒤 천천히 작아져 멈춘다(페이드 아웃).
 * - 문장 사이처럼 아주 잠깐 끊길 때는 끄지 않는다(LINGER_MS).
 * - 명시적인 일시중지는 즉시 멈추고 재생 위치를 보존한다.
 * - 음악은 반복 재생한다. 해설 음성보다 훨씬 작게 튼다. 곡마다 녹음 음량이 달라 서버가 곡별 음량을 주고,
 *   없으면 MUSIC_VOLUME으로 튼다(같은 음량이면 조용한 곡은 해설에 묻혀 안 들린다).
 * - 음악을 못 불러와도 해설에는 영향을 주지 않는다. 그 주소는 이번 실행 동안 다시 시도하지 않는다.
 * 화면은 이 클래스를 직접 쓰지 않고 `use-background-music` 훅을 쓴다.
 */

import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

/** 해설 음성(1.0)에 비한 배경 음악 크기 */
export const MUSIC_VOLUME = 0.25;
/** 해설과 동시에 들리도록 짧게. 0이면 '딱' 소리가 날 수 있어 조금만 준다. */
export const FADE_IN_MS = 300;
export const FADE_OUT_MS = 2000;
/** 해설이 멈춘 뒤 음악을 이만큼 더 들려준 다음 줄이기 시작한다. */
export const LINGER_MS = 1500;
const STEP_MS = 100;

export class BackgroundMusic {
  private url: string | null = null;
  private active = false;
  private paused = false;
  private player: AudioPlayer | null = null;
  private subscription: { remove(): void } | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly failed = new Set<string>();
  private volume = MUSIC_VOLUME;

  /** url: 틀 음악(없으면 끔), active: 해설이 재생 중인지, volume: 이 곡의 음량(0~1). 매번 불러도 바뀐 것만 반영한다. */
  update(url: string | null, active: boolean, paused = false, volume = MUSIC_VOLUME) {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : MUSIC_VOLUME;
    if (url !== this.url) {
      this.release();
      this.url = url;
      this.active = false; this.paused = false;
    }
    // 해설과 동시에 나오도록 곡을 미리 받아 둔다(재생은 해설 음성이 나올 때).
    if (!this.player) this.prepare();
    if (paused) {
      this.clearLinger(); this.clearFade();
      if (!this.paused) this.player?.pause();
      this.paused = true; this.active = false;
      return;
    }
    this.paused = false;
    if (active === this.active) return;
    this.active = active;
    if (active) this.start();
    else this.finish();
  }

  /** 화면을 떠날 때. 바로 멈추고 정리한다. */
  dispose() {
    this.release();
    this.url = null;
    this.active = false; this.paused = false;
  }

  /** 소리 없이 플레이어만 만들어 곡을 받아 둔다. */
  private prepare() {
    const url = this.url;
    if (!url || this.failed.has(url) || this.player) return;
    try {
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
    } catch {
      this.failed.add(url);
      this.release();
    }
  }

  private start() {
    this.clearLinger();
    this.prepare();
    const player = this.player;
    if (!player) return;
    try {
      player.play();
      this.fadeTo(this.volume, FADE_IN_MS);
    } catch {
      if (this.url) this.failed.add(this.url);
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
