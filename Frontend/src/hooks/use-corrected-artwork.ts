import { useEffect, useState } from 'react';
import { ApiError, cachedCorrectedImage, getCorrectedImage } from '@/lib/api';
import { serverCorrection, type ViewingProfile } from '@/lib/calibration';
import { useProfile } from '@/hooks/use-profile';
import { getAccessToken } from '@/store/auth';

export function useCorrectedArtwork(id: string | undefined, source: string | undefined, values: ViewingProfile, original = false, strength = 1) {
  const { loaded, error: profileError, reloadProfile } = useProfile();
  const correction = serverCorrection(values, strength);
  const active = loaded && !profileError && !!id && !!source && !original && (correction.severity > 0 || correction.edge > 0);
  const key = active ? JSON.stringify([getAccessToken(), values.revision, id, source, correction]) : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; source?: string; error?: unknown } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    let alive = true;
    // Sliders may move several times; request only the value the user settles on.
    const timer = setTimeout(() => {
      getCorrectedImage(id, values, strength).then(
        (uri) => { if (alive) setState({ key, source: uri }); },
        (error) => {
          if (!alive) return;
          setState({ key, error });
          if (error instanceof ApiError && error.status === 409) void reloadProfile();
        },
      );
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
    // The key contains exactly the fields that affect the server image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  // A corrected image fetched before (another screen, or going back) shows at once instead of after the delay.
  const cached = active && id ? cachedCorrectedImage(id, values, strength) : undefined;
  const current = state?.key === key ? state : cached ? { key: key!, source: cached } : null;
  // While the first corrected image is on its way, show nothing rather than the uncorrected original,
  // so the picture never flips from "almost corrected" to corrected.
  const shown = !active ? source ?? '' : current?.source ?? (current?.error ? source ?? '' : '');
  return { source: shown, error: profileError || current?.error, loading: active && !current, reload: () => { if (profileError) void reloadProfile(); setState(null); setAttempt((value) => value + 1); } };
}
