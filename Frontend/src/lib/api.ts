/**
 * BE 호출은 여기서만 한다 (README 6.5).
 * `EXPO_PUBLIC_API_URL`이 비어 있으면 `src/mocks/`를 돌려준다.
 * 미술관·번호 조회는 BE에 아직 없어 항상 mock이다 (TODO(BE): 9장 BE 요청 1번).
 */

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

export async function getMuseums(): Promise<Museum[]> {
  return museums;
}

/** 미술관의 작품을 번호 순으로. */
export async function getMuseumArtworks(museumId: string): Promise<Artwork[]> {
  return artworks
    .filter((a) => a.museum_id === museumId)
    .sort((a, b) => a.number.localeCompare(b.number));
}

/** 없으면 404 `ApiError`. */
export async function getArtwork(id: string): Promise<Artwork> {
  if (API_URL) return get<Artwork>(`/artworks/${encodeURIComponent(id)}`);
  const found = artworks.find((a) => a.id === id);
  if (!found) throw new ApiError(404);
  return found;
}
