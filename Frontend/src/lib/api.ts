/** 실제 백엔드만 사용한다. 서버 오류를 임시 데이터로 대체하지 않는다. */
import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';

import type { Artwork, Description } from '@/types/artwork';
import type { Museum } from '@/types/museum';
import type { Narration, GeneratedNarration } from '@/types/narration';
import type { LoginResult, User } from '@/types/auth';
import { clearSession, getAccessToken } from '@/store/auth';
import { serverCorrection, type ViewingProfile } from '@/lib/calibration';

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
    if (res.status === 401 && token && getAccessToken() === token) await clearSession();
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

export async function logout() {
  await request<void>('/auth/logout', { method: 'POST' });
  await clearSession();
}

// Cache only successful results; contrast/brightness do not affect the server image.
const correctedImages = new Map<string, string>();
const pendingCorrections = new Map<string, Promise<string>>();

export function getCorrectedImage(artworkId: string, profile: ViewingProfile, strength = 1): Promise<string> {
  const correction = serverCorrection(profile, strength);
  const key = JSON.stringify([API_URL, artworkId, correction]);
  const cached = correctedImages.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingCorrections.get(key);
  if (pending) return pending;
  const task = (async () => {
    if (!API_URL) throw new ApiError(0, '백엔드 주소가 설정되지 않았어요.');
    const body = new FormData();
    body.append('artwork_id', artworkId);
    body.append('profile', JSON.stringify(correction));
    const token = getAccessToken();
    const res = await fetch(`${API_URL}/correction`, {
      method: 'POST', body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new ApiError(res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
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

export async function getMuseumArtworks(museumId: string): Promise<Artwork[]> {
  const page = await request<Page<Artwork>>(`/artworks?limit=100&museum_id=${encodeURIComponent(museumId)}`);
  return page.items.map(fromServer).sort((a, b) => a.number.localeCompare(b.number));
}

export async function getArtwork(id: string): Promise<Artwork> {
  return fromServer(await request<Artwork>(`/artworks/${encodeURIComponent(id)}`));
}

export async function getNarration(id: string): Promise<Narration> {
  return request<Narration>(`/artworks/${encodeURIComponent(id)}/narration?mode=both`);
}

const generatedNarrations = new Map<string, GeneratedNarration>();
const pendingNarrations = new Map<string, Promise<GeneratedNarration>>();

/** Generated text stays unreviewed and is reused during this app session. */
export function generateNarration(id: string): Promise<GeneratedNarration> {
  const cached = generatedNarrations.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = pendingNarrations.get(id);
  if (pending) return pending;
  const task = request<GeneratedNarration>(`/artworks/${encodeURIComponent(id)}/narration`, { method: 'POST' })
    .then((result) => {
      if (result.fallback || !result.segments.length) throw new ApiError(502, 'AI 해설을 생성하지 못했어요. 다시 시도해 주세요.');
      generatedNarrations.set(id, result);
      return result;
    }).finally(() => pendingNarrations.delete(id));
  pendingNarrations.set(id, task);
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
