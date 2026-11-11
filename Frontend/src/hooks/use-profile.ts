import { useSyncExternalStore } from 'react';

import { getProfileSnapshot, reloadProfile, saveCalibration, saveCorrection, saveNarrationMode, saveViewingSettings, subscribeProfile } from '@/store/profile';

export function useProfile() {
  const state = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getProfileSnapshot);
  return { ...state, saveCalibration, saveCorrection, saveNarrationMode, saveViewingSettings, reloadProfile };
}
