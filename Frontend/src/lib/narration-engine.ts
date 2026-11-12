import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Speech from 'expo-speech';
import { getSpeechAudio } from '@/lib/speech-audio';
import { stopSpeaking } from '@/lib/speech';

type Config = { sentences: string[]; rate: number; repeat: boolean };

/** A late request or native callback must never play after stop, skip or unmount. */
export class NarrationEngine {
  private token = 0;
  private config: Config = { sentences: [], rate: 1, repeat: false };
  private current = 0;
  private speaking = false;
  private paused = false;
  private pendingStart = false;
  private endedWhilePaused = false;
  private audio: AudioPlayer | null = null;
  private subscription: { remove(): void } | null = null;
  private audioModeReady = false;
  /** True while a sentence is read by the phone voice (fallback when the AI voice fails). */
  private deviceSpeaking = false;
  private nextPlayer: { index: number; text: string; audio: AudioPlayer } | null = null;

  constructor(
    private onIndex: (i: number) => void,
    private onPlaying: (on: boolean) => void,
    private onPreparing: (on: boolean) => void,
    private onError: (message: string | null) => void,
    private onPaused: (paused: boolean) => void = () => {},
    private onPosition: (currentTime: number, duration: number) => void = () => {},
    /** 마지막 문장까지 끝까지 읽었을 때만 (멈춤·건너뛰기·화면 이탈은 아님). 감상 피드백을 묻는 데 쓴다. */
    private onComplete: () => void = () => {},
  ) {}

  /** 화면이 바뀐 최신 완료 콜백을 넘긴다(엔진은 한 번만 만든다). */
  setOnComplete(callback: (() => void) | undefined) {
    this.onComplete = callback ?? (() => {});
  }

  configure(config: Config) {
    const changed = config.sentences.length !== this.config.sentences.length
      || config.sentences.some((text, index) => text !== this.config.sentences[index]);
    const repeatChanged = config.repeat !== this.config.repeat;
    if (changed) this.reset();
    this.config = config;
    // Prepare the first sentence before play, without generating the whole narration.
    if (changed && config.sentences[0]) void getSpeechAudio(config.sentences[0]).catch(() => undefined);
    if (config.repeat) this.disposeNext();
    else if (repeatChanged && this.speaking) void this.prepareAhead(this.current, this.token);
  }

  /** One background request at a time, alongside the foreground sentence.
   * Load the next sentence into a silent player and buffer one more WAV behind it.
   * The token prevents stale work from loading/playing audio after stop or a skip.
   */
  private async prepareAhead(index: number, token: number) {
    for (let next = index + 1; next <= index + 2; next++) {
      const text = this.config.sentences[next];
      if (!text || token !== this.token || this.config.repeat) return;
      try {
        const uri = await getSpeechAudio(text);
        if (token !== this.token || this.config.repeat) return;
        if (next === index + 1 && !this.nextPlayer) {
          this.nextPlayer = { index: next, text, audio: createAudioPlayer(uri, { updateInterval: 100 }) };
        }
      } catch {
        // Do not interrupt the sentence currently playing. Explicit playback reports the error.
        return;
      }
    }
  }

  private disposeNext() {
    if (this.nextPlayer) {
      this.nextPlayer.audio.release();
      this.nextPlayer = null;
    }
  }

  private dispose() {
    this.subscription?.remove(); this.subscription = null;
    if (this.audio) {
      this.audio.pause(); this.audio.release(); this.audio = null;
    }
  }

  speakAt(i: number) { void this.start(i); }

  private async start(i: number) {
    const text = this.config.sentences[i];
    if (!text) return;
    const mine = ++this.token;
    this.paused = false; this.pendingStart = true; this.endedWhilePaused = false; this.onPaused(false);
    const prepared = this.nextPlayer?.index === i && this.nextPlayer.text === text ? this.nextPlayer.audio : null;
    if (prepared) this.nextPlayer = null;
    else this.disposeNext();
    this.dispose(); this.audio = prepared; this.current = i; this.speaking = true;
    this.onPosition(0, 0);
    this.onIndex(i); this.onPlaying(true); this.onPreparing(!prepared?.currentStatus.isLoaded); this.onError(null);
    const done = () => {
      if (mine !== this.token) return;
      if (this.config.repeat) this.speakAt(i);
      else if (i + 1 < this.config.sentences.length) this.speakAt(i + 1);
      else { this.stop(); this.current = 0; this.onIndex(0); this.onComplete(); }
    };
    try {
      stopSpeaking();
      // Start the foreground request first so lookahead never takes its generation slot.
      const source = prepared ? null : getSpeechAudio(text);
      // Attach a rejection handler immediately while the audio session is being configured.
      void source?.catch(() => undefined);
      if (!this.config.repeat) void this.prepareAhead(i, mine);
      if (!this.audioModeReady) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false, interruptionMode: 'duckOthers' });
        this.audioModeReady = true;
      }
      if (mine !== this.token) return;
      const uri = source ? await source : null;
      if (mine !== this.token) return;
      const audio = prepared ?? createAudioPlayer(uri!, { updateInterval: 100 });
      this.audio = audio; this.pendingStart = false;
      let started = false;
      let finished = false;
      const statusChanged = (status: AudioStatus) => {
        if (mine !== this.token || finished) return;
        if (status.isLoaded) this.onPosition(status.currentTime, status.duration);
        if (status.error) {
          this.stop(); this.onError('음성을 재생하지 못했어요. 다시 시도해 주세요.');
        } else if (status.didJustFinish) {
          if (this.paused) { this.endedWhilePaused = true; return; }
          finished = true; done();
        }
        else if (status.isLoaded && !started) {
          started = true; this.onPreparing(false);
          audio.shouldCorrectPitch = true;
          audio.setPlaybackRate(this.config.rate, 'high');
          if (!this.paused) audio.play();
        } else if (started && status.playing && !this.paused) {
          this.onPlaying(true); this.speaking = true;
        } else if (started && !status.playing && !status.isBuffering && status.currentTime > 0) {
          this.onPlaying(false); this.speaking = false;
        }
      };
      this.subscription = audio.addListener('playbackStatusUpdate', statusChanged);
      statusChanged(audio.currentStatus);
    } catch {
      if (mine !== this.token) return;
      // The AI voice failed (daily limits, network): read this sentence with the phone's own Korean voice
      // so the narration never goes silent. The next sentence tries the AI voice again.
      this.speakWithDevice(text, mine, done);
    }
  }

  private speakWithDevice(text: string, mine: number, done: () => void) {
    this.pendingStart = false; this.deviceSpeaking = true;
    this.onPreparing(false); this.onPlaying(true); this.speaking = true;
    Speech.speak(text, {
      language: 'ko-KR', rate: this.config.rate,
      onDone: () => { if (mine === this.token) { this.deviceSpeaking = false; done(); } },
      onError: () => {
        if (mine !== this.token) return;
        this.deviceSpeaking = false;
        this.stop(); this.onError('음성을 재생하지 못했어요. 다시 시도해 주세요.');
      },
    });
  }

  pause() {
    this.paused = true; this.speaking = false; this.onPaused(true);
    this.audio?.pause();
    // The phone voice cannot resume mid-sentence: stop it, and play() reads the sentence again.
    if (this.deviceSpeaking) { this.token++; this.deviceSpeaking = false; void Speech.stop(); }
    this.onPlaying(false); this.onPreparing(false);
  }

  stop() {
    if (this.deviceSpeaking) { this.deviceSpeaking = false; void Speech.stop(); }
    this.paused = false; this.pendingStart = false; this.endedWhilePaused = false; this.onPaused(false);
    this.token++; this.speaking = false; this.dispose(); this.disposeNext();
    this.onPlaying(false); this.onPreparing(false);
  }
  reset() { this.stop(); this.current = 0; this.onIndex(0); }
  changeRate(rate: number) {
    this.config = { ...this.config, rate };
    if (this.audio) this.audio.setPlaybackRate(rate, 'high');
  }
  goTo(i: number) {
    const next = Math.max(0, Math.min(this.config.sentences.length - 1, i));
    if (this.speaking) this.speakAt(next);
    else {
      // A new sentence selected while paused starts at its beginning on the next play.
      this.stop(); this.current = next; this.onIndex(next);
    }
  }
  play() {
    if (this.paused && (this.audio || this.pendingStart)) {
      this.paused = false; this.speaking = true; this.onPaused(false); this.onError(null);
      if (this.endedWhilePaused) {
        this.endedWhilePaused = false;
        if (this.config.repeat) this.speakAt(this.current);
        else if (this.current + 1 < this.config.sentences.length) this.speakAt(this.current + 1);
        else this.reset();
        return;
      }
      this.onPlaying(true);
      this.onPreparing(this.pendingStart || !this.audio?.currentStatus.isLoaded);
      if (this.audio?.currentStatus.isLoaded) {
        this.audio.setPlaybackRate(this.config.rate, 'high');
        this.audio.play();
      }
      return;
    }
    if (!this.speaking) this.speakAt(this.current);
  }
}
