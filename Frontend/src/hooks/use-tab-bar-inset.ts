import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/** Tab button height + pill padding + border, see `components/app-tabs.tsx`. */
export const TabBarHeight = 60 + 6 * 2 + 2;
/** Gap between the floating bar and the bottom safe area. */
export const TabBarGap = Spacing.three;

export function useTabBarBottom() {
  return useSafeAreaInsets().bottom + TabBarGap;
}

/** Bottom padding a tab screen needs so its last item is not hidden behind the floating bar. */
export function useTabBarInset() {
  return useTabBarBottom() + TabBarHeight + Spacing.three;
}
