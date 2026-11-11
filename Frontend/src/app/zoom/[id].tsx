import { router, useLocalSearchParams } from 'expo-router';

import { ArtworkFullscreenView } from '@/components/artwork/fullscreen-view';
import { useHistory } from '@/hooks/use-history';
import { useProfile } from '@/hooks/use-profile';
import { useResource } from '@/hooks/use-resource';
import { getArtwork } from '@/lib/api';

export default function ZoomScreen() {
  const { profile: currentProfile } = useProfile();
  const { items: historyItems, loaded: historyLoaded } = useHistory();
  const { id, original, strength, history: historyId } = useLocalSearchParams<{
    id: string;
    original?: string;
    /** 상세 화면의 보정 강도(0~1). 없으면 프로필 값 */
    strength?: string;
    history?: string;
  }>();
  const historyRecord = historyItems.find((item) => item.id === historyId && item.artwork.id === id);
  const profile = currentProfile;
  const { data: artwork, error } = useResource(id ?? null, () => getArtwork(id!));
  const showOriginal = original === '1';
  const rawStrength = Number(strength ?? profile.strength);
  const amount = Number.isFinite(rawStrength) ? Math.max(0, Math.min(1, rawStrength)) : 1;
  const validHistory = !historyId || (historyLoaded && !!historyRecord);
  return <ArtworkFullscreenView
    artwork={validHistory ? artwork ?? null : null}
    profile={profile}
    original={showOriginal}
    strength={amount}
    imageError={historyId && historyLoaded && !historyRecord
      ? '관람 기록을 불러오지 못했어요. 기록 화면에서 다시 선택해 주세요.'
      : error ? '작품 이미지를 불러오지 못했어요' : undefined}
    onClose={() => router.back()}
  />;
}
