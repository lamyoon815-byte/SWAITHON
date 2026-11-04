/**
 * 업로드 전 기기 내 리사이즈와 업로드 시간 측정.
 * 업로드는 EXPO_PUBLIC_UPLOAD_URL이 설정됐을 때만 실행한다 (multipart 필드명 "image").
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const LONG_SIDE = 1024;
export const UPLOAD_URL = process.env.EXPO_PUBLIC_UPLOAD_URL;

export function kb(bytes: number | null | undefined) {
  return bytes == null ? '?' : `${Math.round(bytes / 1024)}KB`;
}

export function fileSize(uri: string) {
  return new File(uri).size;
}

/** 긴 변을 LONG_SIDE로 줄여 JPEG로 저장한다. */
export async function resizeLongSide(uri: string, width: number, height: number) {
  const t0 = performance.now();
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize(width >= height ? { width: LONG_SIDE, height: null } : { width: null, height: LONG_SIDE });
  const rendered = await ctx.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { ...result, ms: Math.round(performance.now() - t0) };
}

/** 업로드 결과 한 줄 요약. URL이 없으면 건너뛴다. */
export async function uploadImage(uri: string) {
  if (!UPLOAD_URL) return '업로드 생략: EXPO_PUBLIC_UPLOAD_URL 미설정';
  const body = new FormData();
  // React Native의 FormData는 { uri, name, type } 형태의 파일 객체를 받는다.
  body.append('image', { uri, name: 'artwork.jpg', type: 'image/jpeg' } as never);
  const t0 = performance.now();
  const res = await fetch(UPLOAD_URL, { method: 'POST', body });
  return `업로드 HTTP ${res.status}, ${Math.round(performance.now() - t0)}ms`;
}
