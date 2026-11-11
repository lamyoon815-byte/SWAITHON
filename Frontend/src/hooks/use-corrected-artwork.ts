import { useEffect, useState } from 'react';
import { getCorrectedImage } from '@/lib/api';
import { serverCorrection, type ViewingProfile } from '@/lib/calibration';

export function useCorrectedArtwork(id: string | undefined, source: string | undefined, values: ViewingProfile, original = false, strength = 1) {
  const correction = serverCorrection(values, strength);
  const active = !!id && !!source && !original && (correction.severity > 0 || correction.edge > 0);
  const key = active ? JSON.stringify([id, source, correction]) : null;
  const [state, setState] = useState<{ key: string; source?: string; error?: unknown } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    let alive = true;
    // Sliders may move several times; request only the value the user settles on.
    const timer = setTimeout(() => {
      getCorrectedImage(id, values, strength).then(
        (uri) => { if (alive) setState({ key, source: uri }); },
        (error) => { if (alive) setState({ key, error }); },
      );
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
    // The key contains exactly the fields that affect the server image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state?.key === key ? state : null;
  return { source: active && current?.source ? current.source : source ?? '', error: current?.error, loading: active && !current };
}
