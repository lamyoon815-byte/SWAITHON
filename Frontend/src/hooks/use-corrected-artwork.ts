import { useEffect, useState } from 'react';
import { ApiError, cachedCorrectedImage, getCorrectedImage } from '@/lib/api';
import { serverCorrection, type ViewingProfile } from '@/lib/calibration';
import { useProfile } from '@/hooks/use-profile';
import { getAccessToken } from '@/store/auth';

/**
 * The server makes one full-strength (100%) corrected picture per artwork and profile.
 * The strength slider only changes how much of it is laid over the original (`overlayAmount`),
 * so moving it updates the picture at once without asking the server again.
 */
export function useCorrectedArtwork(id: string | undefined, source: string | undefined, values: ViewingProfile, original = false, strength = 1) {
  const { loaded, error: profileError, reloadProfile } = useProfile();
  const full = serverCorrection(values, 1);
  const active = loaded && !profileError && !!id && !!source && !original && (full.severity > 0 || full.edge > 0);
  const key = active ? JSON.stringify([getAccessToken(), values.revision, id, source, full]) : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; source?: string; error?: unknown } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    let alive = true;
    getCorrectedImage(id, values, 1).then(
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
  const cached = active && id ? cachedCorrectedImage(id, values, 1) : undefined;
  const current = state?.key === key ? state : cached ? { key: key!, source: cached } : null;
  const overlay = active ? current?.source ?? '' : '';
  // Until the first corrected picture arrives, show nothing rather than the uncorrected original,
  // so the picture never flips from "almost corrected" to corrected. On an error, fall back to the original.
  const shown = !active || overlay || current?.error ? source ?? '' : '';
  return {
    source: shown, overlay, overlayAmount: Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1)),
    error: profileError || current?.error, loading: active && !current,
    reload: () => { if (profileError) void reloadProfile(); setState(null); setAttempt((value) => value + 1); },
  };
}
