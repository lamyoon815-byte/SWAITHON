import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PROFILE, type CorrectionValues, type VisualProfile } from '@/types/profile';
import type { NarrationMode } from '@/types/narration';

const KEY = 'swaithon:profile:v1';
type Snapshot = { profile: VisualProfile; loaded: boolean; saved: boolean; error: boolean };
let snapshot: Snapshot = { profile: DEFAULT_PROFILE, loaded: false, saved: false, error: false };
let loading: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const limits = { contrast: [0.5, 2], brightness: [-1, 1], sharpen: [0, 2] } as const;

export function normalizeCorrection(values: Pick<CorrectionValues, keyof typeof limits>) {
  const clamp = (key: keyof typeof limits) => {
    const value = values[key];
    return Number.isFinite(value)
      ? Math.round(Math.max(limits[key][0], Math.min(limits[key][1], value)) * 100) / 100
      : DEFAULT_PROFILE[key];
  };
  return { contrast: clamp('contrast'), brightness: clamp('brightness'), sharpen: clamp('sharpen') };
}

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function load() {
  loading ??= AsyncStorage.getItem(KEY).then((raw) => {
    const stored = raw ? JSON.parse(raw) : null;
    if (stored !== null && (typeof stored !== 'object' || Array.isArray(stored))) {
      throw new Error('잘못된 프로필 형식');
    }
    const profile = { ...DEFAULT_PROFILE, ...stored };
    if (!['facts', 'interpretations', 'both'].includes(profile.narration_mode)) profile.narration_mode = 'both';
    emit({ profile: { ...profile, ...normalizeCorrection(profile) }, loaded: true, saved: !!stored, error: false });
  }).catch(() => {
    emit({ profile: DEFAULT_PROFILE, loaded: true, saved: false, error: true });
  });
  return loading;
}

export function subscribeProfile(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

export function getProfileSnapshot() { return snapshot; }

/** 로그인 없는 기기 저장 규격. 쓰기 성공 후에만 공유 상태를 갱신한다. */
export async function saveCorrection(values: Pick<CorrectionValues, keyof typeof limits>) {
  return updateProfile(normalizeCorrection(values));
}

export async function saveNarrationMode(narration_mode: NarrationMode) {
  if (!['facts', 'interpretations', 'both'].includes(narration_mode)) throw new Error('잘못된 해설 방식');
  return updateProfile({ narration_mode });
}

function updateProfile(patch: Partial<VisualProfile>) {
  const next = writing.then(async () => {
    await load();
    if (snapshot.error) throw new Error('프로필을 불러오지 못했어요');
    const profile = { ...snapshot.profile, ...patch };
    await AsyncStorage.setItem(KEY, JSON.stringify(profile));
    emit({ profile, loaded: true, saved: true, error: false });
  });
  writing = next.catch(() => {});
  return next;
}

export async function reloadProfile() {
  loading = null;
  await load();
}
