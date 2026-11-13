import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PROFILE, type CorrectionValues, type ViewingSettings, type VisualProfile } from '@/types/profile';
import type { NarrationMode } from '@/types/narration';
import { colorSeverities, isCalibrationSettings, type CalibrationResult } from '@/types/calibration';
import { getProfile, putProfile, submitFeedback, type FeedbackSatisfaction } from '@/lib/api';
import { correctionStrength } from '@/lib/calibration';
import { getAccessToken, getAuthSnapshot, subscribeAuth } from '@/store/auth';

const KEY = 'swaithon:profile:v1';
const MIGRATION_KEY = 'swaithon:profile:db-migration:v1';
type Snapshot = { profile: VisualProfile; loaded: boolean; saved: boolean; error: boolean };
let snapshot: Snapshot = { profile: DEFAULT_PROFILE, loaded: false, saved: false, error: false };
let loading: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
let ownerToken: string | null | undefined;
let generation = 0;

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

function normalizeProfile(value: VisualProfile): VisualProfile {
  const profile = { ...DEFAULT_PROFILE, ...value, ...normalizeCorrection(value), strength: correctionStrength(value.strength) };
  if (!isCalibrationSettings(profile.calibration)) delete profile.calibration;
  return profile;
}

/** 기존 기기 설정은 DB가 비어 있을 때 첫 계정에 한 번만 이관한다. 이후에는 DB만 읽는다. */
async function migrateLegacy(profile: VisualProfile, userId: string, current: () => boolean) {
  const marker = await AsyncStorage.getItem(MIGRATION_KEY).catch(() => 'unavailable');
  if (marker && marker !== `pending:${userId}`) return profile;
  if (profile.calibration) {
    await AsyncStorage.setItem(MIGRATION_KEY, `done:${userId}`).catch(() => {});
    return profile;
  }
  let previous: Partial<VisualProfile> | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    previous = raw ? JSON.parse(raw) : null;
    if (!previous) {
      const rawViewing = await AsyncStorage.getItem('swaithon.viewing.v1');
      const legacy = rawViewing ? JSON.parse(rawViewing) : null;
      if (legacy?.completed && isCalibrationSettings(legacy.values)) previous = {
        calibration: legacy.values, contrast: legacy.values.contrast,
        brightness: legacy.values.brightness, sharpen: legacy.values.sharpness,
      };
    }
  } catch { /* 손상된 기기 데이터로 정상 DB 설정을 대체하지 않는다. */ }
  if (!current()) return profile;
  // 소유자를 먼저 지정하여 계정 전환 중 다른 계정에 옛 설정이 복제되지 않게 한다.
  try { await AsyncStorage.setItem(MIGRATION_KEY, `pending:${userId}`); }
  catch { return profile; }
  if (previous && isCalibrationSettings(previous.calibration) && current()) {
    profile = await putProfile({ ...profile, ...calibrationPatch(previous.calibration),
      ...normalizeCorrection({ ...profile, ...previous }) });
  }
  await AsyncStorage.setItem(MIGRATION_KEY, `done:${userId}`).catch(() => {});
  return profile;
}

function load(): Promise<void> {
  const auth = getAuthSnapshot();
  if (!auth.loaded) return Promise.resolve();
  const token = getAccessToken();
  if (token !== ownerToken) {
    ownerToken = token;
    generation++;
    loading = null;
    writing = Promise.resolve();
    emit({ profile: DEFAULT_PROFILE, loaded: !token, saved: false, error: false });
  }
  if (!token || !auth.session) return Promise.resolve();
  const version = generation;
  const current = () => version === generation && token === getAccessToken();
  loading ??= getProfile().then(async (value) => {
    if (!current()) return;
    const profile = await migrateLegacy(normalizeProfile(value), auth.session!.user.id, current);
    if (current()) emit({ profile: normalizeProfile(profile), loaded: true, saved: !!profile.calibration, error: false });
  }).catch(() => {
    if (current()) emit({ profile: DEFAULT_PROFILE, loaded: true, saved: false, error: true });
  });
  return loading;
}

export function subscribeProfile(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

export function getProfileSnapshot() { return snapshot; }

/** DB 저장 응답을 받은 뒤에만 공유 상태를 갱신한다. */
export async function saveCorrection(values: Pick<CorrectionValues, keyof typeof limits>) {
  return updateProfile(normalizeCorrection(values));
}

export async function saveNarrationMode(narration_mode: NarrationMode) {
  if (!['facts', 'interpretations', 'both'].includes(narration_mode)) throw new Error('잘못된 해설 방식');
  return updateProfile({ narration_mode });
}

/** 검사로 확인한 값만 저장한다. 검사하지 않은 밝기·선명도는 중립값으로 초기화한다. */
export async function saveCalibration(result: CalibrationResult) {
  if (!isCalibrationSettings(result) || ![1, 1.2, 1.4, 1.6, 1.8, 2].includes(result.contrast)) {
    throw new Error('잘못된 보기 설정');
  }
  const { contrast } = result;
  return updateProfile((profile) => ({
    ...calibrationPatch(result, profile.calibration), contrast, brightness: 0, sharpen: 0, strength: 1,
  }));
}

function calibrationPatch(settings: VisualProfile['calibration'], previous?: VisualProfile['calibration']) {
  if (!isCalibrationSettings(settings)) throw new Error('잘못된 보기 설정');
  const { color_type, severity, edge } = settings;
  const combined = settings.color_severities || previous?.color_severities
    || (previous && previous.color_type !== 'normal' && previous.color_type !== color_type);
  const colors = { ...colorSeverities(previous ?? settings), ...settings.color_severities };
  if (!settings.color_severities && color_type !== 'normal') colors[color_type] = severity;
  const calibration = { color_type, severity, edge, ...(combined ? { color_severities: colors } : {}) };
  const colorVision = { normal: 'normal', protan: 'protanopia', deutan: 'deuteranopia', tritan: 'tritanopia' } as const;
  return { calibration, color_vision: colorVision[color_type], color_severity: severity };
}

/** 색 보정·윤곽선과 기존 세부 조정을 하나의 쓰기로 저장하여 부분 저장을 막는다. */
export async function saveViewingSettings(values: ViewingSettings) {
  return updateProfile((profile) => ({ ...calibrationPatch(values, profile.calibration), ...normalizeCorrection(values) }));
}

function updateProfile(patch: Partial<VisualProfile> | ((profile: VisualProfile) => Partial<VisualProfile>)) {
  const token = getAccessToken();
  const next = writing.then(async () => {
    await load();
    if (!token || token !== getAccessToken()) throw new Error('로그인이 필요해요');
    if (snapshot.error) throw new Error('프로필을 불러오지 못했어요');
    // 해설 방식 같은 작은 변경으로 다른 기기에서 저장한 보정값을 덮어쓰지 않는다.
    const latest = await getProfile();
    if (token !== getAccessToken()) throw new Error('계정이 변경되었어요');
    const current = normalizeProfile(latest);
    const profile = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    const saved = await putProfile(profile);
    if (token !== getAccessToken()) throw new Error('계정이 변경되었어요');
    // 먼저 시작된 조회가 늦게 도착해 방금 저장한 값을 되돌리지 못하게 한다.
    generation++;
    loading = Promise.resolve();
    emit({ profile: normalizeProfile(saved), loaded: true, saved: !!saved.calibration, error: false });
  });
  writing = next.catch(() => {});
  return next;
}

/** 감상 피드백을 보내면 서버가 의견대로 바로 적용한다. 바뀐 프로필이 오면 공유 상태도 바꾼다. */
export function sendFeedback(artworkId: string | null, satisfaction: FeedbackSatisfaction, comment?: string, analysisId?: string) {
  const token = getAccessToken();
  const next = writing.then(async () => {
    if (!token || token !== getAccessToken()) throw new Error('로그인이 필요해요');
    const result = await submitFeedback(artworkId, satisfaction, comment, analysisId);
    if (result.profile && token === getAccessToken()) {
      // 먼저 시작된 조회가 늦게 도착해 방금 바꾼 값을 되돌리지 못하게 한다.
      generation++;
      loading = Promise.resolve();
      emit({ profile: normalizeProfile(result.profile), loaded: true, saved: !!result.profile.calibration, error: false });
    }
    return result;
  });
  writing = next.then(() => {}, () => {});
  return next;
}

export async function reloadProfile() {
  generation++;
  loading = null;
  await load();
}

// 로그인·로그아웃·계정 전환 때 이전 계정의 보정값을 즉시 비우고 DB를 다시 조회한다.
subscribeAuth(() => { void load(); });
