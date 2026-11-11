import { useSyncExternalStore } from 'react';

import { finishOnboarding, getSettingsSnapshot, subscribeSettings, updateSettings } from '@/store/settings';

/** `loaded`가 false인 동안은 저장된 값을 아직 못 읽은 것이니 빈 상태를 그리지 않는다. */
export function useSettings() {
  const { settings, loaded } = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );
  return { settings, loaded, updateSettings, finishOnboarding };
}
