import { useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '@/store/auth';

export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
}
