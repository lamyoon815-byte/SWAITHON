import type { ViewingRecord } from '@/store/history';
import { formatCorrection } from '@/lib/profile-format';

/** 날짜 키는 표시 문구와 분리해 다른 연도의 같은 날짜가 섞이지 않게 한다. */
export function groupHistory(items: ViewingRecord[], now = new Date()) {
  const groups = new Map<string, { key: string; title: string; data: ViewingRecord[] }>();
  const sorted = [...items].sort((a, b) => Date.parse(b.viewed_at) - Date.parse(a.viewed_at));
  for (const item of sorted) {
    const date = new Date(item.viewed_at);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const key = `${year}-${month}-${day}`;
    if (!groups.has(key)) groups.set(key, { key, title: `${year === now.getFullYear() ? '' : `${year}년 `}${month}월 ${day}일`, data: [] });
    groups.get(key)!.data.push(item);
  }
  return [...groups.values()];
}

export function historySummary(item: ViewingRecord) {
  const parts = [`보정 ${Math.round(item.profile.strength * 100)}%`];
  if (item.original_compared) parts.push('원본 비교');
  else if (item.profile.contrast !== 1) parts.push(`대비 ${formatCorrection('contrast', item.profile.contrast)}`);
  else if (item.profile.brightness !== 0) parts.push(`밝기 ${formatCorrection('brightness', item.profile.brightness)}`);
  else if (item.profile.sharpen !== 0) parts.push(`선명도 ${formatCorrection('sharpen', item.profile.sharpen)}`);
  return parts.join(' · ');
}
