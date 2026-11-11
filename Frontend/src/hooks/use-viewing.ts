import { useSyncExternalStore } from 'react';
import { getViewingSnapshot, saveViewing, subscribeViewing } from '@/store/viewing';
import { DEFAULT_PROFILE } from '@/types/profile';

export function useViewing() {
  const state = useSyncExternalStore(subscribeViewing, getViewingSnapshot, getViewingSnapshot);
  const { values } = state;
  return {
    ...state, saveViewing,
    profile: { ...DEFAULT_PROFILE, contrast: values.contrast, brightness: values.brightness, sharpen: values.sharpness },
  };
}
