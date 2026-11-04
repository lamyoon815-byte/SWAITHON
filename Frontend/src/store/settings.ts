/**
 * 기기에만 저장하는 설정 (README 6.4 `DeviceSettings`). 서버에 없으므로 다른 폰에서는 초기값이다.
 * 화면은 이 파일을 직접 쓰지 않고 `use-settings` 훅을 쓴다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DeviceSettings = {
  color_name_guide: boolean;
  music_autoplay: boolean;
  font_scale: 'normal' | 'large' | 'xlarge';
  /** 최근 방문 미술관 (1-0). 다음 실행 때 홈 카드에 다시 보여 준다 */
  recent_museum_id: string | null;
};

const KEY = 'swaithon:settings:v1';

export const DefaultSettings: DeviceSettings = {
  color_name_guide: true,
  music_autoplay: false,
  font_scale: 'normal',
  recent_museum_id: null,
};

type Snapshot = { settings: DeviceSettings; loaded: boolean };

let snapshot: Snapshot = { settings: DefaultSettings, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => (raw ? { ...DefaultSettings, ...JSON.parse(raw) } : DefaultSettings))
    .catch(() => DefaultSettings)
    .then((settings) => emit({ settings, loaded: true }));
  return loading;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

export function getSettingsSnapshot() {
  return snapshot;
}

export async function updateSettings(patch: Partial<DeviceSettings>) {
  await load();
  const settings = { ...snapshot.settings, ...patch };
  emit({ settings, loaded: true });
  await AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
}
