import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { getFontScale } from '@/lib/font-scale';

/**
 * Tab button height + pill padding + border, see `components/app-tabs.tsx`. The button is about 62 tall
 * at normal text size and about 70 with the 18pt label at its 1.4× cap, so reserve the larger one.
 */
export const TabBarHeight = 70 + 6 * 2 + 2;
/** Gap between the floating bar and the bottom safe area. */
export const TabBarGap = Spacing.three;

export function useTabBarBottom() {
  return useSafeAreaInsets().bottom + TabBarGap;
}

/** Bottom padding a tab screen needs so its last item is not hidden behind the floating bar. */
export function useTabBarInset() {
  const { settings } = useSettings();
  const extraTextHeight = Math.ceil(16 * (getFontScale(settings.font_scale) - 1) * 1.4 * 1.3);
  return useTabBarBottom() + TabBarHeight + extraTextHeight + Spacing.three;
}
