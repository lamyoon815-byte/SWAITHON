/** 실제 백엔드만 사용한다. 서버 오류를 임시 데이터로 대체하지 않는다. */
import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';

import type { Artwork, Description } from '@/types/artwork';
import type { Museum } from '@/types/museum';
import type { Narration, NarrationMode, NarrationSegment, GeneratedNarration, NarrationLength } from '@/types/narration';
import type { LoginResult, User } from '@/types/auth';
import { clearSession, getAccessToken, updateSessionUser } from '@/store/auth';
import { correctionStrength, serverCorrection, type ViewingProfile } from '@/lib/calibration';
import type { VisualProfile } from '@/types/profile';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, message = `API ${status}`) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
  if (!API_URL) throw new ApiError(0, '백엔드 주소가 설정되지 않았어요.');
  const token = authenticated ? getAccessToken() : null;
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401 && token && getAccessToken() === token) await clearSession(token);
    const error = await res.json().catch(() => null) as { detail?: unknown } | null;
    throw new ApiError(res.status, typeof error?.detail === 'string' ? error.detail : `API ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function login(email: string, password: string) {
  return request<LoginResult>('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  }, false);
}

export function register(email: string, password: string, nickname: string) {
  return request<LoginResult>('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password, nickname: nickname.trim() }),
  }, false);
}

export const getCurrentUser = () => request<User>('/me');
export const getProfile = () => request<VisualProfile>('/me/profile');
export async function putProfile(profile: VisualProfile) {
  const saved = await request<VisualProfile>('/me/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
  });
  correctionEpoch++;
  correctedImages.clear();
  return saved;
}

/** 내 이름(닉네임) 바꾸기 (`PATCH /me`). 성공하면 기기에 저장된 세션의 이름도 바꾼다. */
export async function updateNickname(nickname: string): Promise<User> {
  const user = await request<User>('/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }),
  });
  await updateSessionUser(user);
  return user;
}

export async function logout() {
  const token = getAccessToken();
  await request<void>('/auth/logout', { method: 'POST' });
  await clearSession(token);
}

// Cache only successful results; contrast/brightness do not affect the server image.
const correctedImages = new Map<string, string>();
const pendingCorrections = new Map<string, Promise<string>>();
let correctionEpoch = 0;

/** Already corrected image for exactly this account, profile revision and strength, without waiting. */
export function cachedCorrectedImage(artworkId: string, profile: ViewingProfile, strength = 1, maxSide?: number): string | undefined {
  const token = getAccessToken();
  if (!token || !profile.revision) return undefined;
  const key = JSON.stringify([API_URL, token, correctionEpoch, artworkId, profile.revision, serverCorrection(profile, correctionStrength(strength)), maxSide ?? null]);
  return correctedImages.get(key);
}

/** maxSide: screen-sized picture (smaller download); leave it out for the zoom screen's full resolution. */
export function getCorrectedImage(artworkId: string, profile: ViewingProfile, strength = 1, maxSide?: number): Promise<string> {
  strength = correctionStrength(strength);
  const token = getAccessToken();
  if (!token) return Promise.reject(new ApiError(401, '로그인이 필요해요.'));
  if (!profile.revision) return Promise.reject(new ApiError(409, '보정값을 다시 불러와 주세요.'));
  const epoch = correctionEpoch;
  const correction = serverCorrection(profile, strength);
  const key = JSON.stringify([API_URL, token, epoch, artworkId, profile.revision, correction, maxSide ?? null]);
  const cached = correctedImages.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingCorrections.get(key);
  if (pending) return pending;
  const task = (async () => {
    if (!API_URL) throw new ApiError(0, '백엔드 주소가 설정되지 않았어요.');
    const body = new FormData();
    body.append('artwork_id', artworkId);
    // 개인 보정값을 전송하거나 덮어쓰지 않는다. 서버가 현재 계정 DB에서 직접 읽는다.
    body.append('strength', String(strength));
    body.append('profile_revision', profile.revision!);
    if (maxSide) body.append('max_side', String(maxSide));
    const res = await fetch(`${API_URL}/correction`, {
      method: 'POST', body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      if (res.status === 401 && getAccessToken() === token) await clearSession(token);
      const error = await res.json().catch(() => null) as { detail?: unknown } | null;
      throw new ApiError(res.status, typeof error?.detail === 'string' ? error.detail : '보정본을 불러오지 못했어요. 다시 시도해 주세요.');
    }
    if (res.headers.get('X-Correction-Profile-Revision') !== profile.revision || epoch !== correctionEpoch) {
      throw new ApiError(409, '보정값이 변경되었어요. 다시 불러와 주세요.');
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (epoch !== correctionEpoch) throw new ApiError(409, '보정값이 변경되었어요.');
    // Data URLs work as Skia and expo-image sources on phone, without temporary file lifecycle issues.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const uri = `data:image/jpeg;base64,${btoa(binary)}`;
    correctedImages.set(key, uri);
    if (correctedImages.size > 8) correctedImages.delete(correctedImages.keys().next().value!);
    return uri;
  })().finally(() => pendingCorrections.delete(key));
  pendingCorrections.set(key, task);
  return task;
}

type Page<T> = { items: T[]; total: number };

function fromServer(a: Artwork): Artwork {
  return { ...a, number: a.number ?? '', museum_id: a.museum_id ?? '' };
}

export async function getMuseums(): Promise<Museum[]> {
  return (await request<Page<Museum>>('/museums?limit=100')).items;
}

const byNumber = (a: Artwork, b: Artwork) => a.number.localeCompare(b.number, undefined, { numeric: true });

/** One page (up to 100) of a museum's artworks in number order, plus the museum's total. */
export async function getMuseumArtworkPage(museumId: string, offset = 0, limit = 100): Promise<{ items: Artwork[]; total: number }> {
  const page = await request<Page<Artwork>>(`/artworks?limit=${limit}&offset=${offset}&museum_id=${encodeURIComponent(museumId)}`);
  return { items: page.items.map(fromServer).sort(byNumber), total: page.total };
}

/** The first 100 artworks. Large museums have more: use getMuseumArtworkPage / getArtworkByNumber. */
export async function getMuseumArtworks(museumId: string): Promise<Artwork[]> {
  return (await getMuseumArtworkPage(museumId)).items;
}

export async function getArtworkByNumber(museumId: string, number: string): Promise<Artwork> {
  return fromServer(await request<Artwork>(`/artworks/by-number?number=${encodeURIComponent(number)}&museum_id=${encodeURIComponent(museumId)}`));
}

export async function getArtwork(id: string): Promise<Artwork> {
  return fromServer(await request<Artwork>(`/artworks/${encodeURIComponent(id)}`));
}

export async function getNarration(id: string, mode: NarrationMode = 'both'): Promise<Narration> {
  return request<Narration>(`/artworks/${encodeURIComponent(id)}/narration?mode=${mode}`);
}

const generatedNarrations = new Map<string, GeneratedNarration>();
const pendingNarrations = new Map<string, Promise<GeneratedNarration>>();

/** Generated text stays unreviewed and is reused during this app session.
 * brief = 간결하게(약 1분), detailed = 상세하게(약 3분, 미술사 정보와 출처). */
export function generateNarration(id: string, length: NarrationLength = 'brief'): Promise<GeneratedNarration> {
  const key = `${id}:${length}`;
  const cached = generatedNarrations.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingNarrations.get(key);
  if (pending) return pending;
  const task = request<GeneratedNarration>(`/artworks/${encodeURIComponent(id)}/narration?length=${length}`, { method: 'POST' })
    .then((result) => {
      if (result.fallback || !result.segments.length) throw new ApiError(502, '해설을 준비하지 못했어요. 다시 시도해 주세요.');
      generatedNarrations.set(key, result);
      return result;
    }).finally(() => pendingNarrations.delete(key));
  pendingNarrations.set(key, task);
  return task;
}

export type RecognitionCandidate = {
  artwork_id: string;
  title: string;
  artist: string;
  score: number;
  image_url: string;
};

export type RecognitionResult = {
  candidates: RecognitionCandidate[];
  status: 'matched' | 'needs_confirmation' | 'no_match';
  confidence: 'high' | 'medium' | 'low';
  next_action: 'show_artwork' | 'confirm_candidates' | 'analyze' | 'retake';
  message: string;
  reason: 'matched' | 'low_confidence' | 'unregistered_artwork' | 'not_artwork' | 'placard_unreadable';
  artwork_probability: number | null;
};

export type AnalysisResult = {
  description: Description;
  /** 사실·감상이 자연스럽게 이어지는 서버의 낭독 순서 */
  segments: NarrationSegment[];
  review_status: 'unreviewed';
  warning: string;
  fallback: boolean;
};

async function upload<T>(path: string, uri: string): Promise<T> {
  const body = new FormData();
  if (Platform.OS === 'web') {
    const photo = await fetch(uri);
    body.append('image', await photo.blob(), 'capture.jpg');
  } else {
    body.append('image', new File(uri) as unknown as Blob);
  }
  return request<T>(path, { method: 'POST', body });
}

export function recognizeArtwork(uri: string): Promise<RecognitionResult> {
  return upload<RecognitionResult>('/recognize/artwork', uri);
}

export function analyzeArtwork(uri: string): Promise<AnalysisResult> {
  return upload<AnalysisResult>('/analyze', uri);
}

/** 짧은 음성을 글자로 (`POST /transcribe`). 녹음 파일은 m4a.
 * purpose: 'answer'(화면 맞추기 숫자 답, 기본) · 'artwork'(작품 음성 검색, 등록 작품 이름을 받아쓰기 힌트로 씀) */
export async function transcribeAnswer(uri: string, purpose: 'answer' | 'artwork' = 'answer'): Promise<string> {
  const body = new FormData();
  body.append('purpose', purpose);
  if (Platform.OS === 'web') {
    const audio = await fetch(uri);
    body.append('audio', await audio.blob(), 'answer.webm');
  } else {
    body.append('audio', new File(uri) as unknown as Blob);
  }
  return (await request<{ text: string }>('/transcribe', { method: 'POST', body })).text;
}

export type VoiceAnswerStep = 'screening' | 'color' | 'edge' | 'contrast';

/** 말로 답한 결과(인식된 글자·앱이 맞춘 보기)를 서버 DB에 저장 (`POST /calibration/voice-answers`). 음성 원본은 보내지 않는다. */
export function saveVoiceAnswer(data: {
  session_id: string; step: VoiceAnswerStep; choices: string[]; transcript: string;
  choice: string | null; expected?: string; item?: string;
}) {
  return request<{ id: string; is_correct: boolean | null }>('/calibration/voice-answers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }, false);
}

export type MoodCategory = 'calm' | 'lyrical' | 'bright' | 'pastoral' | 'sacred' | 'majestic' | 'melancholy' | 'dramatic' | 'dreamy' | 'korean';

export type NarrationMood = {
  category: MoodCategory;
  /** 화면에 보일 분위기 이름 (예: "경건·성스러움") */
  name: string;
  /** 잔잔한 곡(soft) / 움직임 있는 곡(lively). 분위기마다 두 곡 중 해설에 맞는 곡 */
  energy: 'soft' | 'lively';
  /** 화면에 보일 이름 ("잔잔한 곡" / "움직임 있는 곡") */
  energy_name: string;
  /** 배경 음악 MP3 전체 주소 (`GET /music/{category}/{energy}`) */
  music_url: string;
  /** 출처 표시가 필요한 곡(CC BY)이면 화면에 보여 줄 문구 */
  credit: string | null;
  /** gemini(해설 글 분류) · image(그림으로 미리 분류) · keywords(분위기 단어) · default(평온) */
  source: 'gemini' | 'image' | 'keywords' | 'default';
};

const moods = new Map<string, Promise<NarrationMood>>();

/** 해설 전체 글의 분위기(10가지 중 하나)·에너지(잔잔/움직임)와 배경 음악 주소 (`POST /narration/mood`). 같은 글은 앱이 켜져 있는 동안 다시 묻지 않는다. */
export function getNarrationMood(text: string, artworkId?: string, moodKeywords: string[] = []): Promise<NarrationMood> {
  const body = { text: text.slice(0, 6000), artwork_id: artworkId, mood_keywords: moodKeywords.slice(0, 10) };
  const key = JSON.stringify(body);
  const cached = moods.get(key);
  if (cached) return cached;
  const task = request<NarrationMood>('/narration/mood', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((mood) => ({ ...mood, music_url: `${API_URL}${mood.music_url}` }));
  moods.set(key, task);
  task.catch(() => moods.delete(key)); // 실패는 저장하지 않아서 다음에 다시 묻는다.
  return task;
}
