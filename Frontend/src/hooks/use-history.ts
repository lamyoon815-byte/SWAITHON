import { useSyncExternalStore } from 'react';

import { getHistorySnapshot, reloadHistory, subscribeHistory } from '@/store/history';

export function useHistory() {
  const state = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
  return { ...state, reloadHistory };
}
