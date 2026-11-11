import { File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { API_URL, ApiError } from '@/lib/api';
import { getAccessToken } from '@/store/auth';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/** Cache audio, so repeating a sentence and changing playback speed do not synthesize it again. */
export function getSpeechAudio(text: string): Promise<string> {
  const key = JSON.stringify([API_URL, text]);
  const stored = cache.get(key);
  if (stored && (Platform.OS === 'web' || new File(stored).exists)) {
    cache.delete(key); cache.set(key, stored);
    return Promise.resolve(stored);
  }
  const active = pending.get(key);
  if (active) return active;
  const task = (async () => {
    if (!API_URL) throw new ApiError(0, '음성 서버 주소가 설정되지 않았어요.');
    const token = getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000);
    try {
      const send = () => fetch(`${API_URL}/speech`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }), signal: controller.signal,
      });
      let response = await send();
      // Every voice model can hit its per-minute limit at the same moment; they free up within seconds,
      // so wait briefly and ask again instead of leaving the sentence silent.
      for (let retry = 0; response.status === 429 && retry < 2; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        response = await send();
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { detail?: string } | null;
        throw new ApiError(response.status, error?.detail ?? '음성을 만들지 못했어요.');
      }
      const bytes = await response.arrayBuffer();
      let uri: string;
      if (Platform.OS === 'web') {
        uri = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      } else {
        const id = response.headers.get('X-Voice-Cache-Key');
        if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid audio cache key');
        const file = new File(Paths.cache, `momi-voice-${id}.wav`);
        file.create({ overwrite: true });
        file.write(new Uint8Array(bytes));
        uri = file.uri;
      }
      cache.set(key, uri);
      while (cache.size > 32) {
        const oldest = cache.keys().next().value!;
        const previous = cache.get(oldest)!;
        cache.delete(oldest);
        if (Platform.OS === 'web') URL.revokeObjectURL(previous);
        else { try { new File(previous).delete(); } catch { /* OS cache may already have removed it. */ } }
      }
      return uri;
    } finally { clearTimeout(timer); }
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
