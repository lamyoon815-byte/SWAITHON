import type { DataSourceParam, SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import { loadCanvasImage } from '@/lib/load-canvas-image';

export function useCanvasImage(source: DataSourceParam, attempt: number) {
  const [result, setResult] = useState<{ source: DataSourceParam; attempt: number; image: SkImage | null; failed: boolean }>();
  useEffect(() => {
    let active = true;
    loadCanvasImage(source).then(
      (image) => { if (active) setResult({ source, attempt, image, failed: false }); },
      () => { if (active) setResult({ source, attempt, image: null, failed: true }); },
    );
    return () => { active = false; };
  }, [source, attempt]);
  const current = result?.source === source && result?.attempt === attempt ? result : undefined;
  return { image: current?.image ?? null, failed: current?.failed ?? false };
}
