/**
 * BE 호출은 여기서만 한다 (README 6.5).
 * `EXPO_PUBLIC_API_URL`이 비어 있으면 `src/mocks/`를 돌려준다.
 * 작품·해설·인식은 토큰 없이 부른다. 회원가입·로그인·로그아웃만 계정 API를 쓴다(아래 "회원 인증").
 * 보정 설정은 아직 기기에만 저장한다(`store/profile.ts`, `store/settings.ts`).
 */

import { File } from 'expo-file-system';

import artworksMock from '@/mocks/artworks.json';
import museumsMock from '@/mocks/museums.json';
import type { Artwork } from '@/types/artwork';
import type { Session, User } from '@/types/auth';
import type { Museum } from '@/types/museum';
import type { Narration, NarrationMode, NarrationSegment } from '@/types/narration';

export const API_URL = process.env.EXPO_PUBLIC_API_URL;

const artworks = artworksMock as Artwork[];
const museums = museumsMock as Museum[];

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<T>;
}

type Page<T> = { items: T[]; total: number };

/** BE는 `number`·`museum_id`가 null일 수 있다. 화면은 문자열을 기대하므로 빈 문자열로 맞춘다. */
function fromServer(a: Artwork): Artwork {
  return { ...a, number: a.number ?? '', museum_id: a.museum_id ?? '' };
}

/**
 * mock 미술관·작품(FE 임시 데이터)은 서버를 붙여도 그대로 보여 주고, BE에 등록된 것을 뒤에 더한다.
 * BE에 연결하지 못해도 mock은 보인다.
 */
export async function getMuseums(): Promise<Museum[]> {
  if (!API_URL) return museums;
  const server = await get<Page<Museum>>('/museums?limit=100')
    .then((page) => page.items)
    .catch(() => [] as Museum[]);
  return [...museums, ...server.filter((m) => !museums.some((mock) => mock.id === m.id))];
}

/** 미술관의 작품을 번호 순으로. mock 미술관이면 mock 작품, 아니면 BE 작품. */
export async function getMuseumArtworks(museumId: string): Promise<Artwork[]> {
  const isMock = museums.some((m) => m.id === museumId);
  const list =
    API_URL && !isMock
      ? (
          await get<Page<Artwork>>(`/artworks?limit=100&museum_id=${encodeURIComponent(museumId)}`)
        ).items.map(fromServer)
      : artworks.filter((a) => a.museum_id === museumId);
  return list.sort((a, b) => a.number.localeCompare(b.number));
}

/** mock에 있으면 mock, 없으면 BE에서 찾는다. 없으면 404 `ApiError`. */
export async function getArtwork(id: string): Promise<Artwork> {
  const found = artworks.find((a) => a.id === id);
  if (found) return found;
  if (API_URL) return fromServer(await get<Artwork>(`/artworks/${encodeURIComponent(id)}`));
  throw new ApiError(404);
}

/**
 * 검수된 해설 문장들 (`GET /artworks/{id}/narration`, README 6.2). 로그인 없이 부른다.
 * 기기에 저장한 해설 방식을 쿼리로 보내며 생략하면 both로 받는다.
 * mock 작품은 `description`으로 같은 모양을 만든다. 검수 해설이 없으면 409 `ApiError`.
 */
export async function getNarration(id: string, mode: NarrationMode = 'both'): Promise<Narration> {
  const mock = artworks.find((a) => a.id === id);
  if (mock || !API_URL) {
    const d = mock?.description;
    if (!mock) throw new ApiError(404);
    if (!d) throw new ApiError(409);
    const all: NarrationSegment[] = [
      ...d.facts.map((text) => ({ type: 'fact' as const, text, region_index: null })),
      ...d.interpretations.map((text) => ({
        type: 'interpretation' as const,
        text: `가능한 감정적 해석입니다. ${text}`,
        region_index: null,
      })),
    ];
    const segments = all.filter((s) => mode === 'both' || (mode === 'facts' ? s.type === 'fact' : s.type === 'interpretation'));
    return {
      artwork_id: id,
      mode,
      segments,
      text: segments.map((s) => s.text).join('\n'),
      review_status: 'reviewed',
    };
  }
  return get<Narration>(`/artworks/${encodeURIComponent(id)}/narration?mode=${mode}`);
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
};

/**
 * 촬영본으로 작품 후보를 찾는다 (`POST /recognize`, README 6.3). 로그인 없이 호출한다.
 * 서버가 없으면 인식할 수 없으므로 0 상태의 `ApiError`를 던진다.
 */
export async function recognizeArtwork(uri: string): Promise<RecognitionResult> {
  if (!API_URL) throw new ApiError(0);
  const body = new FormData();
  // SDK 58의 fetch(expo/fetch)는 RN식 { uri, name, type } 파일 객체를 못 보낸다
  // ("Unsupported FormDataPart implementation"). bytes()가 있는 expo-file-system File을 넣는다.
  body.append('image', new File(uri) as unknown as Blob);
  body.append('mode', 'artwork');
  const res = await fetch(`${API_URL}/recognize`, { method: 'POST', body });
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<RecognitionResult>;
}

// ── 회원 인증 (`/auth/*`, Backend/accounts.py) ──────────────────────────────

type LoginResult = { access_token: string; token_type: string; expires_in: number; user: User };

/** 화면에 그대로 보여 줄 수 있는 한국어 메시지를 담는다. */
export class AuthError extends Error {}

function authMessage(status: number, kind: 'login' | 'register') {
  if (status === 401) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (status === 409) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (status === 422) return kind === 'register' ? '이메일 형식과 비밀번호(8자 이상)를 확인해 주세요.' : '이메일과 비밀번호를 확인해 주세요.';
  if (status === 429) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.';
  return '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function toSession(result: LoginResult): Session {
  return { token: result.access_token, user: result.user, expires_at: Date.now() + result.expires_in * 1000 };
}

/** 서버가 없을 때(개발용 mock) 쓰는 기기 안 계정. 화면 흐름만 확인한다. */
function mockSession(email: string, nickname?: string): Session {
  return {
    token: `mock-${Date.now()}`,
    user: { id: `mock-${email}`, email, nickname: nickname || email.split('@')[0], created_at: new Date().toISOString() },
    expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
}

async function postAuth(path: string, body: object, kind: 'login' | 'register'): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AuthError(authMessage(0, kind));
  }
  if (!res.ok) throw new AuthError(authMessage(res.status, kind));
  return toSession((await res.json()) as LoginResult);
}

export async function login(email: string, password: string): Promise<Session> {
  if (!API_URL) return mockSession(email);
  return postAuth('/auth/login', { email, password }, 'login');
}

export async function register(email: string, password: string, nickname: string): Promise<Session> {
  if (!API_URL) return mockSession(email, nickname);
  return postAuth('/auth/register', { email, password, nickname }, 'register');
}

/** 서버 세션을 지운다. 실패해도(오프라인·만료) 기기에서는 로그아웃하므로 에러를 던지지 않는다. */
export async function logout(token: string): Promise<void> {
  if (!API_URL || token.startsWith('mock-')) return;
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}
