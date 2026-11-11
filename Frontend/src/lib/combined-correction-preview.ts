import { COMBINED_PREVIEWS } from '@/assets/images/correction-preview';
import type { ViewingSettings } from '@/types/profile';

/** 같은 원본의 색 보정×윤곽선 조합. 대비·밝기·선명도는 이미지에 굽지 않는다. */
export function combinedCorrectionPreview(values: ViewingSettings, original = false) {
  if (original) return COMBINED_PREVIEWS.normal[0][0];
  const level = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value * 5))) : 0;
  const severity = values.color_type === 'normal' ? 0 : level(values.severity);
  return COMBINED_PREVIEWS[values.color_type][severity][level(values.edge)];
}
