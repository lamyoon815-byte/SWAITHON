import { router, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSettings } from '@/hooks/use-settings';
import { useProfile } from '@/hooks/use-profile';

/** 첫 홈 실행만 소개로 보낸다. 직접 연 화면이나 개발용 URL은 가로채지 않는다. */
export function FirstLaunch() {
  const { settings, loaded } = useSettings();
  const { profile, loaded: profileLoaded, error } = useProfile();
  const navigation = useRootNavigationState();
  const pathname = usePathname();
  const checked = useRef(false);
  useEffect(() => {
    if (!loaded || !profileLoaded || error || !navigation?.key || checked.current) return;
    checked.current = true;
    if (pathname !== '/') return;
    if (!settings.onboarding_completed) router.replace('/onboarding');
    else if (!profile.calibration) router.replace('/onboarding/calibration');
  }, [loaded, profileLoaded, error, profile.calibration, navigation?.key, pathname, settings.onboarding_completed]);
  return null;
}
