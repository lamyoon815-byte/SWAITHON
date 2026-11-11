import { router } from 'expo-router';
import { useProfile } from '@/hooks/use-profile';
import { formatCorrection } from '@/lib/profile-format';

/** 마이페이지의 보정 요약과 보정 화면 진입을 한 곳에서 제공한다. */
export function useCorrectionEntry() {
  const { profile, loaded, saved, error } = useProfile();
  const description = !loaded ? '불러오는 중이에요'
    : error ? '보정값을 불러오지 못했어요'
    : saved ? `대비 ${formatCorrection('contrast', profile.contrast)} · 밝기 ${formatCorrection('brightness', profile.brightness)} · 선명도 ${formatCorrection('sharpen', profile.sharpen)}`
    : '아직 보정값을 설정하지 않았어요';
  return { description, onPress: () => router.push('/correction') };
}
