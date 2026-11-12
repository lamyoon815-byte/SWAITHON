/**
 * 기기에만 저장하는 설정 (README 6.4 `DeviceSettings`). 서버에 없으므로 다른 폰에서는 초기값이다.
 * 화면은 이 파일을 직접 쓰지 않고 `use-settings` 훅을 쓴다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DeviceSettings = {
  color_name_guide: boolean;
  /** 해설 배경 음악. 기본 켜짐. (예전 `music_autoplay`는 음악이 연결되기 전에 꺼짐으로 저장된 값이라 쓰지 않는다) */
  background_music: boolean;
  font_scale: 'normal' | 'large' | 'xlarge';
  /** 최근 방문 미술관 (1-0). 다음 실행 때 홈 카드에 다시 보여 준다 */
  recent_museum_id: string | null;
  /** 소개를 완료하거나 건너뛰면 다음 실행부터 홈으로 진입한다. */
  onboarding_completed: boolean;
};

const KEY = 'swaithon:settings:v1';

export const DefaultSettings: DeviceSettings = {
  color_name_guide: true,
  background_music: true,
  font_scale: 'normal',
  recent_museum_id: null,
  onboarding_completed: false,
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
    .then(async (raw) => {
      const settings = raw ? { ...DefaultSettings, ...JSON.parse(raw) } : { ...DefaultSettings };
      // 명시적으로 초기화한 false는 존중하고, 필드가 없던 구버전 설정만 이관한다.
      if (!raw || !Object.hasOwn(JSON.parse(raw), 'onboarding_completed')) {
        const previous = await AsyncStorage.getItem('swaithon.viewing.v1');
        if (previous && JSON.parse(previous).completed === true) settings.onboarding_completed = true;
      }
      return settings;
    })
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

/** 완료 여부는 디스크 저장에 성공해야만 반영한다. 실패 시 소개 화면에서 재시도한다. */
export async function finishOnboarding() {
  await load();
  const settings = { ...snapshot.settings, onboarding_completed: true };
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  emit({ settings, loaded: true });
}
