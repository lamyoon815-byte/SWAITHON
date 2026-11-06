/**
 * Spike: Skia ColorMatrix correction + pinch / pan / double-tap zoom on a high-res image.
 * Zoom is applied as a Skia transform (not a View transform) so detail stays sharp when zoomed in.
 */

import {
  Canvas,
  ColorMatrix,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  RuntimeShader,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BigButton } from '@/components/common/big-button';
import { InfoText, Row } from '@/components/spike/section';
import type { Palette } from '@/constants/a11y';
import { correctionMatrix } from '@/lib/color-matrix';
import { getSharpenEffect } from '@/lib/sharpen';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 3;

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/** Keep the scaled content covering the canvas: translation in [size - size*s, 0]. */
function clampTranslate(t: number, size: number, s: number) {
  'worklet';
  return clamp(t, size - size * s, 0);
}

type Props = {
  source: number;
  accessibilityLabel: string;
  contrast: SharedValue<number>;
  brightness: SharedValue<number>;
  strength: SharedValue<number>;
  sharpen: SharedValue<number>;
  showOriginal: SharedValue<boolean>;
  palette: Palette;
};

export function CorrectionCanvas({
  source,
  accessibilityLabel,
  contrast,
  brightness,
  strength,
  sharpen,
  showOriginal,
  palette,
}: Props) {
  const { image, loadMs } = useTimedImage(source);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize({ width: w, height: h });
    width.set(w);
    height.set(h);
  };

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const matrix = useDerivedValue(() =>
    correctionMatrix(
      contrast.get(),
      brightness.get(),
      showOriginal.get() ? 0 : strength.get(),
    ),
  );
  const sharpenUniforms = useDerivedValue(() => ({
    amount: showOriginal.get() ? 0 : sharpen.get() * strength.get(),
  }));
  const transform = useDerivedValue(() => [
    { translateX: tx.get() },
    { translateY: ty.get() },
    { scale: scale.get() },
  ]);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const s0 = scale.get();
      const s1 = clamp(s0 * e.scaleChange, MIN_SCALE, MAX_SCALE);
      const k = s1 / s0;
      // Keep the content point under the fingers' focal point fixed.
      tx.set(clampTranslate(e.focalX - (e.focalX - tx.get()) * k, width.get(), s1));
      ty.set(clampTranslate(e.focalY - (e.focalY - ty.get()) * k, height.get(), s1));
      scale.set(s1);
    },
  });

  const pan = usePanGesture({
    averageTouches: true,
    onUpdate: (e) => {
      'worklet';
      const s = scale.get();
      tx.set(clampTranslate(tx.get() + e.changeX, width.get(), s));
      ty.set(clampTranslate(ty.get() + e.changeY, height.get(), s));
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      const s = scale.get();
      if (s > 1.01) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        return;
      }
      const px = (e.x - tx.get()) / s;
      const py = (e.y - ty.get()) / s;
      scale.set(withTiming(DOUBLE_TAP_SCALE));
      tx.set(withTiming(clampTranslate(e.x - px * DOUBLE_TAP_SCALE, width.get(), DOUBLE_TAP_SCALE)));
      ty.set(withTiming(clampTranslate(e.y - py * DOUBLE_TAP_SCALE, height.get(), DOUBLE_TAP_SCALE)));
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  // Buttons are the only way to zoom while VoiceOver/TalkBack is on (screen readers swallow pinch).
  const zoomBy = (factor: number) => {
    const s0 = scale.get();
    const s1 = clamp(s0 * factor, MIN_SCALE, MAX_SCALE);
    const k = s1 / s0;
    const cx = size.width / 2;
    const cy = size.height / 2;
    scale.set(withTiming(s1));
    tx.set(withTiming(clampTranslate(cx - (cx - tx.get()) * k, size.width, s1)));
    ty.set(withTiming(clampTranslate(cy - (cy - ty.get()) * k, size.height, s1)));
    AccessibilityInfo.announceForAccessibility(`${s1.toFixed(1)}배 확대`);
  };
  const resetZoom = () => {
    scale.set(withTiming(1));
    tx.set(withTiming(0));
    ty.set(withTiming(0));
    AccessibilityInfo.announceForAccessibility('원래 크기');
  };

  const fpsText = useUiFps();

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.canvasBox, { borderColor: palette.border }]}
          onLayout={onLayout}
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Group transform={transform}>
              <Image
                image={image}
                fit="contain"
                x={0}
                y={0}
                width={size.width}
                height={size.height}
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}>
                <ColorMatrix matrix={matrix} />
                {getSharpenEffect() ? (
                  <RuntimeShader source={getSharpenEffect()!} uniforms={sharpenUniforms} />
                ) : null}
              </Image>
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
      <Row>
        <BigButton label="확대 +" onPress={() => zoomBy(1.5)} palette={palette} />
        <BigButton label="축소 −" onPress={() => zoomBy(1 / 1.5)} palette={palette} />
        <BigButton label="원래 크기" onPress={resetZoom} palette={palette} selected={false} />
      </Row>
      <InfoText palette={palette}>
        {image
          ? `원본 ${image.width()}×${image.height()} · 로드+디코드 ${loadMs}ms · ${fpsText}`
          : '이미지 불러오는 중…'}
      </InfoText>
    </View>
  );
}

/** Like Skia's useImage, but reports how long load + decode took. */
function useTimedImage(source: number) {
  const [state, setState] = useState<{ image: SkImage | null; loadMs: number }>({
    image: null,
    loadMs: 0,
  });
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    Skia.Data.fromURI(Asset.fromModule(source).uri).then((data) => {
      const image = Skia.Image.MakeImageFromEncoded(data);
      if (!cancelled) setState({ image, loadMs: Math.round(performance.now() - t0) });
    });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return state;
}

/** Average / worst UI-thread FPS over 1s windows. Approximate: Skia draws are driven from the UI thread. */
function useUiFps() {
  const [text, setText] = useState('UI FPS -');
  const frames = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const worst = useSharedValue(0);
  useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt == null) return;
    frames.set(frames.get() + 1);
    elapsed.set(elapsed.get() + dt);
    worst.set(Math.max(worst.get(), dt));
    if (elapsed.get() >= 1000) {
      const avg = Math.round((frames.get() * 1000) / elapsed.get());
      const low = Math.round(1000 / worst.get());
      scheduleOnRN(setText, `UI FPS 평균 ${avg} / 최저 ${low}`);
      frames.set(0);
      elapsed.set(0);
      worst.set(0);
    }
  });
  return text;
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  canvasBox: {
    height: 320,
    borderWidth: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
