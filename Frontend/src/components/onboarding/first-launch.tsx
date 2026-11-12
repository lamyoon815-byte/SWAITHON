import { router, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSettings } from '@/hooks/use-settings';

/** 첫 홈 실행만 소개로 보낸다. 직접 연 화면이나 개발용 URL은 가로채지 않는다. */
export function FirstLaunch() {
  const { settings, loaded } = useSettings();
  const navigation = useRootNavigationState();
  const pathname = usePathname();
  const checked = useRef(false);
  useEffect(() => {
    if (!loaded || !navigation?.key || checked.current) return;
    if (pathname !== '/') return;
    checked.current = true;
    if (!settings.onboarding_completed) router.replace('/onboarding');
  }, [loaded, navigation?.key, pathname, settings.onboarding_completed]);
  return null;
}
