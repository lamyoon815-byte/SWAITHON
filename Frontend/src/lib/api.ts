/**
 * BE 호출은 여기서만 한다 (README 6.5).
 * `EXPO_PUBLIC_API_URL`이 비어 있으면 `src/mocks/`를 돌려준다.
 * 로그인은 쓰지 않는다. 설정은 기기에만 저장하고(`store/settings.ts`), BE는 토큰 없이 부른다.
 */

import { File } from 'expo-file-system';

import artworksMock from '@/mocks/artworks.json';
import museumsMock from '@/mocks/museums.json';
import type { Artwork } from '@/types/artwork';
import type { Museum } from '@/types/museum';

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
      ? (await get<Page<Artwork>>(`/artworks?limit=100&museum_id=${encodeURIComponent(museumId)}`)).items.map(fromServer)
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
