import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * Tab button height + pill padding + border, see `components/app-tabs.tsx`. The button is 60 tall
 * at normal text size and about 66 with the label at its 1.4× cap, so reserve the larger one.
 */
export const TabBarHeight = 66 + 6 * 2 + 2;
/** Gap between the floating bar and the bottom safe area. */
export const TabBarGap = Spacing.three;

export function useTabBarBottom() {
  return useSafeAreaInsets().bottom + TabBarGap;
}

/** Bottom padding a tab screen needs so its last item is not hidden behind the floating bar. */
export function useTabBarInset() {
  return useTabBarBottom() + TabBarHeight + Spacing.three;
}
