import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Artwork } from '@/types/artwork';
import type { VisualProfile } from '@/types/profile';

export type ViewingRecord = {
  id: string;
  viewed_at: string;
  artwork: Pick<Artwork, 'id' | 'title' | 'artist' | 'museum_id' | 'image_url'>;
  profile: VisualProfile;
  original_compared: boolean;
};

const KEY = 'swaithon:viewing-history:v1';
type Snapshot = { items: ViewingRecord[]; loaded: boolean; error: boolean };
let snapshot: Snapshot = { items: [], loaded: false, error: false };
let loading: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function validRecord(item: ViewingRecord) {
  const p = item?.profile;
  return typeof item?.id === 'string' && typeof item?.viewed_at === 'string'
    && Number.isFinite(Date.parse(item.viewed_at)) && typeof item?.artwork?.id === 'string'
    && typeof item.artwork.title === 'string' && typeof item.artwork.artist === 'string'
    && typeof item.artwork.image_url === 'string' && typeof item.original_compared === 'boolean'
    && p && Number.isFinite(p.contrast) && p.contrast >= 0.5 && p.contrast <= 2
    && Number.isFinite(p.brightness) && p.brightness >= -1 && p.brightness <= 1
    && Number.isFinite(p.sharpen) && p.sharpen >= 0 && p.sharpen <= 2
    && Number.isFinite(p.strength) && p.strength >= 0 && p.strength <= 1;
}

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function load() {
  loading ??= AsyncStorage.getItem(KEY).then((raw) => {
    const items = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items) || !items.every(validRecord)) throw new Error('잘못된 관람 기록');
    emit({ items: items.sort((a, b) => Date.parse(b.viewed_at) - Date.parse(a.viewed_at)), loaded: true, error: false });
  }).catch(() => emit({ items: [], loaded: true, error: true }));
  return loading;
}

export function subscribeHistory(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

export function getHistorySnapshot() { return snapshot; }

/** 같은 감상 세션은 갱신하고, 다른 날짜·세션의 관람 기록은 보존한다. */
export function recordViewing(record: ViewingRecord) {
  const captured = { ...record, artwork: { ...record.artwork }, profile: { ...record.profile } };
  const next = writing.then(async () => {
    await load();
    if (snapshot.error || !validRecord(captured)) throw new Error('관람 기록을 저장하지 못했어요');
    const previous = snapshot.items.find((item) => item.id === captured.id);
    const item = { ...captured, viewed_at: previous?.viewed_at ?? captured.viewed_at, original_compared: captured.original_compared || !!previous?.original_compared };
    const items = [item, ...snapshot.items.filter((entry) => entry.id !== item.id)]
      .sort((a, b) => Date.parse(b.viewed_at) - Date.parse(a.viewed_at));
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
    emit({ items, loaded: true, error: false });
  });
  writing = next.catch(() => {});
  return next;
}

export async function reloadHistory() {
  await writing;
  loading = null;
  await load();
}
