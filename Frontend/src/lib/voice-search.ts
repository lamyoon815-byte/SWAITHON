/**
 * 작품 음성 검색: `/transcribe`(purpose=artwork)가 돌려준 글자로 지금 미술관의 작품을 찾는다.
 * - "5번", "오번", "12번 보여줘" → 명패 번호 검색
 * - "수련", "모네 수련 찾아줘", "거대한 파도" → 제목(괄호 속 별칭·원제 포함)이 맞는 작품
 * - "고흐", "모네" → 그 작가의 작품들
 * 받아쓰기가 조금 틀려도 찾도록 글자 두 개씩 겹치는 정도(Dice 유사도)도 본다.
 */

import { spokenNumbers } from '@/lib/spoken-answer';
import type { Artwork } from '@/types/artwork';

export type VoiceSearchResult =
  | { kind: 'number'; number: string }
  | { kind: 'artworks'; items: Artwork[] }
  | { kind: 'none' };

// 문장 끝의 부탁·말끝 ("찾아줘", "보여 주세요", "검색해줘", "작품", "요" 등)
const TAIL = /(을|를)?\s*(찾아\s*(줘|주세요|줄래요?|봐\s*줘)|보여\s*(줘|주세요)|검색\s*(해\s*(줘|주세요))?|알려\s*(줘|주세요)|열어\s*(줘|주세요)|작품|그림|이요|요|[.!?~,])\s*$/;
const TITLE_SCORE = 1;
const ARTIST_SCORE = 0.8; // 작가 이름만 맞으면 그 작가 작품이 모두 나오므로 제목보다 낮게
const MIN_SCORE = 0.5;

export function compact(text: string) {
  return text.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function stripTail(text: string) {
  let value = text.trim();
  for (let i = 0; i < 5; i++) {
    const next = value.replace(TAIL, '').trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function bigrams(value: string) {
  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i++) grams.push(value.slice(i, i + 2));
  return grams;
}

/** 글자 두 개씩 묶은 조각이 얼마나 겹치는지 (0~1). */
export function similarity(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const left = bigrams(a);
  const right = bigrams(b);
  const pool = [...right];
  let shared = 0;
  for (const gram of left) {
    const at = pool.indexOf(gram);
    if (at !== -1) { shared++; pool.splice(at, 1); }
  }
  return (2 * shared) / (left.length + right.length);
}

function titleNames(artwork: Artwork) {
  const names = [artwork.title, artwork.original_title ?? ''];
  // "가나가와 해변의 높은 파도 아래 (거대한 파도)" → 괄호 밖과 괄호 속을 따로
  for (const title of [artwork.title, artwork.original_title ?? '']) {
    names.push(title.replace(/\(.*?\)/g, ''));
    for (const m of title.matchAll(/\((.*?)\)/g)) names.push(m[1]);
    names.push(...title.split(/\s+-\s+|:\s*/));
  }
  return names.map(compact).filter((name) => name.length >= 2);
}

function artistNames(artwork: Artwork) {
  const names = [artwork.artist, artwork.original_artist ?? ''];
  // "빈센트 반 고흐" → "고흐", "클로드 모네" → "모네"
  for (const artist of [artwork.artist, artwork.original_artist ?? '']) {
    const parts = artist.trim().split(/\s+/);
    if (parts.length > 1) names.push(parts[parts.length - 1]);
  }
  return names.map(compact).filter((name) => name.length >= 2);
}

function nameScore(query: string, name: string) {
  if (query.includes(name)) return 1; // "모네 수련 찾아줘" ⊃ "수련"
  // 이름의 일부만 말한 경우 ("파도" ⊂ "거대한 파도"): 많이 말할수록 높게
  if (name.includes(query) && query.length >= 2) return 0.5 + 0.5 * (query.length / name.length);
  return similarity(query, name);
}

export function findArtworksBySpeech(text: string, artworks: Artwork[]): VoiceSearchResult {
  const spoken = stripTail(text);
  const query = compact(spoken);
  if (!query) return { kind: 'none' };

  // 번호만 말한 경우 ("5번", "오 번", "12")
  if (/^[0-9영공일이삼사오육륙칠팔구십\s]+번?$/.test(spoken)) {
    const number = spokenNumbers(spoken)[0];
    if (number !== undefined) return { kind: 'number', number };
  }

  const scored = artworks
    .map((artwork) => {
      const title = Math.max(0, ...titleNames(artwork).map((name) => nameScore(query, name))) * TITLE_SCORE;
      const artist = Math.max(0, ...artistNames(artwork).map((name) => nameScore(query, name))) * ARTIST_SCORE;
      return { artwork, score: Math.max(title, artist) };
    })
    .filter((item) => item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: 'none' };
  // 가장 잘 맞는 것과 비슷한 점수만 남긴다 ("모네 수련"이면 수련만, "모네"면 모네 작품 모두).
  const best = scored[0].score;
  return { kind: 'artworks', items: scored.filter((item) => item.score >= best - 0.15).map((item) => item.artwork) };
}
