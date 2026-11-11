import { useSyncExternalStore } from 'react';
import { getDisplayNameSnapshot, reloadDisplayNames, saveDisplayName, subscribeDisplayName } from '@/store/display-name';

export function useDisplayName(userId: string | undefined, fallback: string) {
  const { names, loaded, error } = useSyncExternalStore(subscribeDisplayName, getDisplayNameSnapshot, getDisplayNameSnapshot);
  return {
    name: userId ? names[userId] ?? fallback : fallback, loaded, error,
    save: (value: string) => userId ? saveDisplayName(userId, value) : Promise.reject(new Error('로그인이 필요해요.')),
    reload: reloadDisplayNames,
  };
}
