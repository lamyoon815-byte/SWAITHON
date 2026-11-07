/**
 * 최근 본 작품 (검색 화면의 "최근 본 작품", 네이버 "최근 검색어" 자리). 기기에만 저장한다.
 * 작품 상세에 들어갈 때 `addRecent`로 남기고, 화면은 `use-recent` 훅으로 읽는다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Artwork } from '@/types/artwork';

/** 목록에 보여 줄 만큼만 저장한다. 작품이 바뀌어도 id로 다시 불러온다. */
export type RecentArtwork = Pick<
  Artwork,
  'id' | 'title' | 'artist' | 'number' | 'museum_id' | 'image_url'
> & {
  /** ISO 날짜 */
  viewed_at: string;
};

const KEY = 'swaithon:recent-artworks:v1';
const MAX = 20;

type Snapshot = { items: RecentArtwork[]; loaded: boolean };

let snapshot: Snapshot = { items: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(items: RecentArtwork[]) {
  snapshot = { items, loaded: true };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => (raw ? (JSON.parse(raw) as RecentArtwork[]) : []))
    .catch(() => [])
    .then((items) => {
      snapshot = { items, loaded: true };
      listeners.forEach((l) => l());
    });
  return loading;
}

export function subscribeRecent(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

export function getRecentSnapshot() {
  return snapshot;
}

/** 맨 앞에 넣고, 같은 작품이 있으면 예전 것은 지운다. */
export async function addRecent(artwork: Artwork) {
  await load();
  const item: RecentArtwork = {
    id: artwork.id,
    title: artwork.title,
    artist: artwork.artist,
    number: artwork.number,
    museum_id: artwork.museum_id,
    image_url: artwork.image_url,
    viewed_at: new Date().toISOString(),
  };
  emit([item, ...snapshot.items.filter((a) => a.id !== artwork.id)].slice(0, MAX));
}

export async function removeRecent(id: string) {
  await load();
  emit(snapshot.items.filter((a) => a.id !== id));
}

export async function clearRecent() {
  await load();
  emit([]);
}
