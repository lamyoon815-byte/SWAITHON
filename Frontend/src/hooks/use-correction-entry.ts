import { showToast } from '@/components/common/toast';
import { useProfile } from '@/hooks/use-profile';
import { formatCorrection } from '@/lib/profile-format';

/** 보정 설정의 진입점. 별도 보정 브랜치에서 실제 화면으로 연결한다. */
export function useCorrectionEntry() {
  const { profile, loaded, saved, error } = useProfile();
  const description = !loaded ? '불러오는 중이에요'
    : error ? '보정값을 불러오지 못했어요'
    : saved ? `대비 ${formatCorrection('contrast', profile.contrast)} · 밝기 ${formatCorrection('brightness', profile.brightness)} · 선명도 ${formatCorrection('sharpen', profile.sharpen)}`
    : '아직 보정값을 설정하지 않았어요';
  return { description, onPress: () => showToast('내 보정값 화면은 준비 중이에요') };
}
