import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PROFILE, type CorrectionValues, type ViewingSettings, type VisualProfile } from '@/types/profile';
import type { NarrationMode } from '@/types/narration';
import { isCalibrationSettings, type CalibrationResult } from '@/types/calibration';

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
  loading ??= AsyncStorage.getItem(KEY).then(async (raw) => {
    if (!raw) {
      // Preserve settings saved by the earlier authenticated app before the stores were unified.
      const legacyRaw = await AsyncStorage.getItem('swaithon.viewing.v1');
      const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
      if (legacy?.completed && isCalibrationSettings(legacy.values)) {
        const { color_type, severity, edge, contrast, brightness, sharpness } = legacy.values;
        const colorVision = { normal: 'normal', protan: 'protanopia', deutan: 'deuteranopia', tritan: 'tritanopia' } as const;
        raw = JSON.stringify({ ...DEFAULT_PROFILE, calibration: { color_type, severity, edge },
          color_vision: colorVision[color_type as keyof typeof colorVision], color_severity: severity,
          ...normalizeCorrection({ contrast, brightness, sharpen: sharpness }) });
        await AsyncStorage.setItem(KEY, raw);
      }
    }
    const stored = raw ? JSON.parse(raw) : null;
    if (stored !== null && (typeof stored !== 'object' || Array.isArray(stored))) {
      throw new Error('잘못된 프로필 형식');
    }
    const profile = { ...DEFAULT_PROFILE, ...stored };
    if (!['facts', 'interpretations', 'both'].includes(profile.narration_mode)) profile.narration_mode = 'both';
    if (!isCalibrationSettings(profile.calibration)) delete profile.calibration;
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

/** 테스트 결과와 Skia 대비를 한 번에 저장한다. 기존 밝기·선명도·접근성 설정은 유지한다. */
export async function saveCalibration(result: CalibrationResult) {
  if (!isCalibrationSettings(result) || ![1, 1.2, 1.4, 1.6, 1.8, 2].includes(result.contrast)) {
    throw new Error('잘못된 보기 설정');
  }
  const { color_type, severity, edge, contrast } = result;
  return updateProfile({
    ...calibrationPatch({ color_type, severity, edge }), contrast,
  });
}

function calibrationPatch(settings: VisualProfile['calibration']) {
  if (!isCalibrationSettings(settings)) throw new Error('잘못된 보기 설정');
  const { color_type, severity, edge } = settings;
  const colorVision = { normal: 'normal', protan: 'protanopia', deutan: 'deuteranopia', tritan: 'tritanopia' } as const;
  return { calibration: { color_type, severity, edge }, color_vision: colorVision[color_type], color_severity: severity };
}

/** 색 보정·윤곽선과 기존 세부 조정을 하나의 쓰기로 저장하여 부분 저장을 막는다. */
export async function saveViewingSettings(values: ViewingSettings) {
  return updateProfile({ ...calibrationPatch(values), ...normalizeCorrection(values) });
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
