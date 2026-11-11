/**
 * 등록되지 않은 작품의 AI 분석 결과를 화면 사이에 넘긴다(사진 경로 + 분석 결과는 주소 파라미터로 넘기기엔 크다).
 * 앱이 꺼지면 사라지는 메모리 보관이다. 서버도 사진을 저장하지 않는다.
 */

import type { AnalysisResult } from '@/lib/api';

export type AnalysisEntry = { photoUri: string; result: AnalysisResult };

const entries = new Map<string, AnalysisEntry>();
let next = 1;

export function putAnalysis(entry: AnalysisEntry): string {
  const id = String(next++);
  entries.set(id, entry);
  // 오래된 결과는 버린다(사진 경로가 계속 쌓이지 않게).
  while (entries.size > 5) entries.delete(entries.keys().next().value!);
  return id;
}

export function getAnalysis(id: string | undefined): AnalysisEntry | undefined {
  return id ? entries.get(id) : undefined;
}
