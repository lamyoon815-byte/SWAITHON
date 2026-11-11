import { router, useLocalSearchParams } from 'expo-router';

import { ArtworkZoomView } from '@/components/artwork/zoom-view';
import { useHistory } from '@/hooks/use-history';
import { useNarrationPlayer } from '@/hooks/use-narration-player';
import { useProfile } from '@/hooks/use-profile';
import { useResource } from '@/hooks/use-resource';
import { ApiError, generateNarration, getArtwork, getNarration } from '@/lib/api';

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
  // 해설 화면과 같은 키라서 이미 받아 둔 해설을 다시 받지 않는다.
  const mode = currentProfile.narration_mode;
  const narration = useResource(id ? `narration:${id}:${mode}` : null, () => getNarration(id!, mode));
  const noReviewed = narration.error instanceof ApiError && narration.error.status === 409;
  const aiNarration = useResource(noReviewed && id ? `ai-narration:${id}` : null, () => generateNarration(id!));
  const allSegments = aiNarration.data?.segments ?? narration.data?.segments ?? [];
  const segments = allSegments.filter((s) => mode === 'both' || (mode === 'facts' ? s.type === 'fact' : s.type === 'interpretation'));
  const player = useNarrationPlayer(segments.map((segment) => segment.text), currentProfile.speech_rate, false);
  const validHistory = !historyId || (historyLoaded && !!historyRecord);
  return <ArtworkZoomView
    artwork={validHistory ? artwork ?? null : null}
    profile={profile}
    original={showOriginal}
    strength={amount}
    player={player}
    sentences={segments.map((segment) => segment.text)}
    narrationFailed={!!((narration.error && !noReviewed) || aiNarration.error)}
    imageError={historyId && historyLoaded && !historyRecord
      ? '관람 기록을 불러오지 못했어요. 기록 화면에서 다시 선택해 주세요.'
      : error ? '작품 이미지를 불러오지 못했어요' : undefined}
    onClose={() => router.back()}
  />;
}
