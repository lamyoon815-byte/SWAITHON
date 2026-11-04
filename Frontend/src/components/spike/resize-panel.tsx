/**
 * Spike: on-device resize (long side 1024px) before upload, and upload timing.
 */

import { Asset } from 'expo-asset';
import { useState } from 'react';

import { BigButton } from '@/components/common/big-button';
import { InfoText, Row, Section } from '@/components/spike/section';
import type { Palette } from '@/constants/a11y';
import { fileSize, kb, LONG_SIDE, resizeLongSide, uploadImage } from '@/lib/resize';

export function ResizePanel({ source, palette }: { source: number; palette: Palette }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  const run = async () => {
    setRunning(true);
    const out: string[] = [];
    try {
      const asset = await Asset.fromModule(source).downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const w = asset.width ?? 0;
      const h = asset.height ?? 0;
      out.push(`원본 ${w}×${h}, ${kb(fileSize(uri))}`);

      const result = await resizeLongSide(uri, w, h);
      out.push(`리사이즈 ${result.width}×${result.height}, ${kb(fileSize(result.uri))}, ${result.ms}ms`);
      out.push(await uploadImage(result.uri));
    } catch (e) {
      out.push(`오류: ${(e as Error).message}`);
    }
    setLines(out);
    setRunning(false);
  };

  return (
    <Section title="4. 리사이즈 · 업로드" palette={palette}>
      <Row>
        <BigButton
          label={running ? '측정 중…' : `${LONG_SIDE}px 리사이즈 측정`}
          onPress={run}
          palette={palette}
          disabled={running}
        />
      </Row>
      {lines.map((line) => (
        <InfoText key={line} palette={palette}>
          {line}
        </InfoText>
      ))}
    </Section>
  );
}
