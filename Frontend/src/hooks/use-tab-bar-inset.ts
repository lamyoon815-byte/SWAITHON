import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { getFontScale } from '@/lib/font-scale';

/**
 * Tab button height + pill padding + border, see `components/app-tabs.tsx`. The button is about 62 tall
 * at normal text size and about 70 with the 18pt label at its 1.4× cap, so reserve the larger one.
 */
export const TabBarHeight = 70 + 6 * 2 + 2;
/** 홈 막대가 없는 기기(홈 버튼 아이폰·대부분의 안드로이드)에서 화면 끝과 탭 바 사이 최소 간격. */
export const TabBarGap = Spacing.two;

/**
 * 떠 있는 탭 바의 아래 위치. 아이폰 홈 막대 영역(약 34pt)을 다 비우지 않고 70%만 비워 탭 바를 낮춘다
 * (홈 막대 바로 위까지는 내려가지 않아, 탭을 누르다 홈으로 나가는 일은 거의 없다).
 */
export function useTabBarBottom() {
  return Math.max(TabBarGap, Math.round(useSafeAreaInsets().bottom * 0.7));
}

/** Bottom padding a tab screen needs so its last item is not hidden behind the floating bar. */
export function useTabBarInset() {
  const { settings } = useSettings();
  const extraTextHeight = Math.ceil(16 * (getFontScale(settings.font_scale) - 1) * 1.4 * 1.3);
  return useTabBarBottom() + TabBarHeight + extraTextHeight + Spacing.three;
}
