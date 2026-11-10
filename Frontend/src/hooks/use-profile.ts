import { useSyncExternalStore } from 'react';

import { getProfileSnapshot, reloadProfile, saveCorrection, saveNarrationMode, subscribeProfile } from '@/store/profile';

export function useProfile() {
  const state = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getProfileSnapshot);
  return { ...state, saveCorrection, saveNarrationMode, reloadProfile };
}
