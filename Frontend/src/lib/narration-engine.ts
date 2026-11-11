import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { getSpeechAudio } from '@/lib/speech-audio';
import { stopSpeaking } from '@/lib/speech';

type Config = { sentences: string[]; rate: number; repeat: boolean };

/** A late request or native callback must never play after stop, skip or unmount. */
export class NarrationEngine {
  private token = 0;
  private config: Config = { sentences: [], rate: 1, repeat: false };
  private current = 0;
  private speaking = false;
  private audio: AudioPlayer | null = null;
  private subscription: { remove(): void } | null = null;
  private audioModeReady = false;

  constructor(
    private onIndex: (i: number) => void,
    private onPlaying: (on: boolean) => void,
    private onPreparing: (on: boolean) => void,
    private onError: (message: string | null) => void,
  ) {}

  configure(config: Config) {
    const changed = config.sentences[0] !== this.config.sentences[0];
    this.config = config;
    // Have the first sentence ready before the person presses play.
    if (changed) this.prefetch(0);
  }

  /** Generate a sentence's audio in the background so it plays without a gap. Failures surface when it is played. */
  private prefetch(i: number) {
    const text = this.config.sentences[i];
    if (text) void getSpeechAudio(text).catch(() => undefined);
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
    this.dispose(); this.current = i; this.speaking = true;
    this.onIndex(i); this.onPlaying(true); this.onPreparing(true); this.onError(null);
    const done = () => {
      if (mine !== this.token) return;
      if (this.config.repeat) this.speakAt(i);
      else if (i + 1 < this.config.sentences.length) this.speakAt(i + 1);
      else { this.stop(); this.current = 0; this.onIndex(0); }
    };
    // While this sentence is prepared and read, the next one is generated (the server makes two at a time).
    if (!this.config.repeat) this.prefetch(i + 1);
    try {
      stopSpeaking();
      if (!this.audioModeReady) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false, interruptionMode: 'duckOthers' });
        this.audioModeReady = true;
      }
      if (mine !== this.token) return;
      const uri = await getSpeechAudio(text);
      if (mine !== this.token) return;
      const audio = createAudioPlayer(uri, { updateInterval: 100 });
      this.audio = audio;
      let started = false;
      const statusChanged = (status: AudioStatus) => {
        if (mine !== this.token) return;
        if (status.error) {
          this.stop(); this.onError('음성을 재생하지 못했어요. 다시 시도해 주세요.');
        } else if (status.didJustFinish) done();
        else if (status.isLoaded && !started) {
          started = true; this.onPreparing(false);
          audio.shouldCorrectPitch = true;
          audio.setPlaybackRate(this.config.rate, 'high'); audio.play();
        } else if (started && status.playing) {
          this.onPlaying(true); this.speaking = true;
        } else if (started && !status.playing && !status.isBuffering && status.currentTime > 0) {
          this.onPlaying(false); this.speaking = false;
        }
      };
      this.subscription = audio.addListener('playbackStatusUpdate', statusChanged);
      statusChanged(audio.currentStatus);
    } catch (error) {
      if (mine !== this.token) return;
      this.stop(); this.onError(error instanceof Error ? error.message : '음성을 만들지 못했어요. 다시 시도해 주세요.');
    }
  }

  stop() {
    this.token++; this.speaking = false; this.dispose();
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
    else { this.current = next; this.onIndex(next); }
  }
  play() { this.speakAt(this.current); }
}
