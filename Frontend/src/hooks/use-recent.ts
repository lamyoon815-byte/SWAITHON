import { useSyncExternalStore } from 'react';

import {
  addRecent,
  clearRecent,
  getRecentSnapshot,
  removeRecent,
  subscribeRecent,
} from '@/store/recent';

/** 최근 본 작품. `loaded`가 false인 동안은 저장된 값을 아직 못 읽은 것이니 빈 상태를 그리지 않는다. */
export function useRecent() {
  const { items, loaded } = useSyncExternalStore(
    subscribeRecent,
    getRecentSnapshot,
    getRecentSnapshot,
  );
  return { items, loaded, addRecent, removeRecent, clearRecent };
}
