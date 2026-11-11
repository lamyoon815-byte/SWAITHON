import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { showToast } from '@/components/common/toast';
import { recordViewing, type ViewingRecord } from '@/store/history';
import type { Artwork } from '@/types/artwork';
import type { VisualProfile } from '@/types/profile';

/** 진입 시와 화면을 떠날 때만 저장한다. 슬라이더를 끌 때마다 디스크에 쓰지 않는다. */
export function useRecordViewing(artwork: Artwork | undefined, profile: VisualProfile, strength: number, original: boolean, ready: boolean, enabled: boolean) {
  const [session] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const artworkId = artwork?.id;
  const latest = useRef<ViewingRecord | null>(null);
  useEffect(() => {
    if (!artwork || !ready || !enabled) { latest.current = null; return; }
    latest.current = {
      id: `${session}-${artwork.id}`,
      viewed_at: latest.current?.artwork.id === artwork.id ? latest.current.viewed_at : new Date().toISOString(),
      artwork: { id: artwork.id, title: artwork.title, artist: artwork.artist, museum_id: artwork.museum_id, image_url: artwork.image_url },
      profile: { ...profile, strength },
      original_compared: original || (latest.current?.artwork.id === artwork.id && latest.current.original_compared),
    };
  }, [artwork, profile, strength, original, ready, enabled, session]);

  useFocusEffect(useCallback(() => {
    if (!artworkId || !ready || !enabled) return;
    const save = () => {
      if (latest.current) void recordViewing(latest.current).catch(() => showToast('관람 기록을 저장하지 못했어요', 'error'));
    };
    save();
    return save;
  }, [artworkId, ready, enabled]));
}
