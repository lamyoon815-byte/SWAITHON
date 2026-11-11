import { useEffect, useState } from 'react';
import { ApiError, cachedCorrectedImage, getCorrectedImage } from '@/lib/api';
import { serverCorrection, type ViewingProfile } from '@/lib/calibration';
import { useProfile } from '@/hooks/use-profile';
import { getAccessToken } from '@/store/auth';

/** Screen-sized corrected picture: a much smaller download than the full original. */
export const SCREEN_SIDE = 1280;

/**
 * The server makes one full-strength (100%) corrected picture per artwork and profile.
 * The original shows at once; the corrected picture fades in over it when it arrives, and the
 * strength slider only changes how much of it covers the original (no new request while dragging).
 * `maxSide`: SCREEN_SIDE for normal screens, undefined for the zoom screen (full resolution).
 */
export function useCorrectedArtwork(id: string | undefined, source: string | undefined, values: ViewingProfile, original = false, strength = 1, maxSide: number | undefined = SCREEN_SIDE) {
  const { loaded, error: profileError, reloadProfile } = useProfile();
  const full = serverCorrection(values, 1);
  // Start as soon as the artwork id is known; the original image URL is not needed for the request.
  const active = loaded && !profileError && !!id && !original && (full.severity > 0 || full.edge > 0
    || Object.values(full.color_severities ?? {}).some((value) => value > 0));
  const key = active ? JSON.stringify([getAccessToken(), values.revision, id, full, maxSide ?? null]) : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; source?: string; error?: unknown } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    let alive = true;
    getCorrectedImage(id, values, 1, maxSide).then(
      (uri) => { if (alive) setState({ key, source: uri }); },
      (error) => {
        if (!alive) return;
        setState({ key, error });
        if (error instanceof ApiError && error.status === 409) void reloadProfile();
      },
    );
    return () => { alive = false; };
    // The key contains exactly the fields that affect the server image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  // A corrected picture fetched before (another screen, or going back) shows at once.
  const cached = active && id ? cachedCorrectedImage(id, values, 1, maxSide) : undefined;
  const current = state?.key === key ? state : cached ? { key: key!, source: cached } : null;
  return {
    source: source ?? '',
    overlay: active ? current?.source ?? '' : '',
    overlayAmount: Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1)),
    error: profileError || current?.error, loading: active && !current,
    reload: () => { if (profileError) void reloadProfile(); setState(null); setAttempt((value) => value + 1); },
  };
}
