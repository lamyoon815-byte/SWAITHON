/**
 * 작품 이미지를 Skia로 실시간 보정해서 그린다 (대비 · 밝기 · 선명도 · 보정 강도, 원본 전환).
 * `zoomable`이면 핀치 · 두 손가락 이동 · 더블탭 확대와 확대/축소 버튼을 함께 쓴다.
 *
 * 쓰는 화면: 2 작품 감상, 3 해설 재생 (B) / 6 캘리브레이션, 6-1, 8-1 (A).
 * 보정값은 BE 시각 프로필 그대로 넘기면 된다: `<CorrectionCanvas correction={profile} … />`.
 * 슬라이더나 토글은 각 화면이 만든다. 이 컴포넌트는 그리기만 한다.
 *
 * 확대는 Skia 변환으로 처리해서 확대해도 붓터치가 흐려지지 않는다 (스파이크 검증, README 3장).
 */

import {
  Canvas,
  ColorMatrix,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  RuntimeShader,
  useImage,
  type DataSourceParam,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/common/text';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { BigButton } from '@/components/common/big-button';
import { MascotLoading } from '@/components/common/mascot-loading';
import { FontSize, type Palette } from '@/constants/a11y';
import { correctionMatrix } from '@/lib/color-matrix';
import { colorCorrectionUniforms, getColorCorrectionEffect } from '@/lib/color-correction';
import { getSharpenEffect } from '@/lib/sharpen';
import type { CorrectionValues } from '@/types/profile';
import type { ColorSeverities } from '@/types/calibration';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 3;
const BUTTON_STEP = 1.5;

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
  /** 서버 이미지 URL(`artwork.image_url`) 또는 `require('@/assets/…')`. 빈 값이면 "준비 중" 안내 */
  source: DataSourceParam;
  /** 스크린리더가 읽는 이름. 예: "별이 빛나는 밤, 빈센트 반 고흐" */
  accessibilityLabel: string;
  correction: CorrectionValues;
  /** 내 보정값 미리보기만 사용한다. 작품 이미지는 서버에서 이미 색 보정했다. */
  colorSeverities?: ColorSeverities;
  /** true면 보정 없이 원본을 그린다 */
  original?: boolean;
  /** 서버가 만든 100% 색각·윤곽 보정본. 있으면 원본 위에 overlayAmount 비율로 겹쳐 그려
   *  보정 강도 슬라이더가 서버 왕복 없이 바로 반영된다. */
  overlay?: DataSourceParam;
  /** 0~1. 보통 "내 보정값 적용 비율" */
  overlayAmount?: number;
  /** 슬라이더를 끄는 동안의 비율. 주면 React 다시 그리기 없이 UI 스레드에서 바로 반영된다(overlayAmount·correction.strength 대신 사용) */
  liveAmount?: SharedValue<number>;
  /** 보정본을 기다리는 중이면 원본 대신 카멜레온 로딩(MascotLoading)을 보여 주고, 도착하면 보정본을 바로 그린다 */
  waiting?: boolean;
  /** 핀치 · 이동 · 더블탭 확대와 확대/축소 버튼. 캘리브레이션처럼 비교만 할 때는 끈다 */
  zoomable?: boolean;
  palette: Palette;
  /** 캔버스 상자의 크기와 모양. 기본 높이 320 */
  style?: StyleProp<ViewStyle>;
  /** 캔버스 + 확대 버튼 묶음의 스타일. 화면을 꽉 채울 때 `{ flex: 1 }` */
  containerStyle?: StyleProp<ViewStyle>;
};

export function CorrectionCanvas({
  source,
  accessibilityLabel,
  correction,
  colorSeverities,
  original = false,
  overlay,
  overlayAmount = 1,
  liveAmount,
  waiting,
  zoomable = false,
  palette,
  style,
  containerStyle,
}: Props) {
  // Remember which source failed, so a new source clears the error without an effect.
  const [failedSource, setFailedSource] = useState<DataSourceParam>(null);
  const image = useImage(source || null, () => setFailedSource(source));
  const overlayImage = useImage(overlay || null);
  // The corrected picture fades in over the original when it arrives (no blank box, no hard jump).
  const fade = useSharedValue(0);
  // A screen that waits for the corrected picture shows it at full strength at once (no original flash).
  const waitsForOverlay = waiting !== undefined;
  useEffect(() => {
    fade.set(overlayImage ? (waitsForOverlay ? 1 : withTiming(1, { duration: 250 })) : 0);
  }, [overlayImage, fade, waitsForOverlay]);
  // Keep the chameleon until the corrected picture is decoded, not just downloaded.
  const showLoader = !original && (!!waiting || (waitsForOverlay && !!overlay && !overlayImage));
  const failed = !!source && failedSource === source;

  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize({ width: w, height: h });
    width.set(w);
    height.set(h);
  };

  const { contrast, brightness, sharpen, strength } = correction;
  const staticAmount = Number.isFinite(strength) ? clamp(strength, 0, 1) : 1;
  const staticOverlay = clamp(Number.isFinite(overlayAmount) ? overlayAmount : 1, 0, 1);
  // Everything that depends on the strength is derived on the UI thread, so dragging the slider
  // updates the picture every frame without re-rendering the screen.
  const live = useDerivedValue(() => (liveAmount ? clamp(liveAmount.get(), 0, 1) : -1));
  const matrix = useDerivedValue(() => {
    const amount = original ? 0 : live.get() >= 0 ? live.get() : staticAmount;
    return correctionMatrix(contrast, brightness, amount);
  });
  const sharpenUniforms = useDerivedValue(() => ({
    amount: sharpen * (original ? 0 : live.get() >= 0 ? live.get() : staticAmount),
  }));
  const overlayOpacity = useDerivedValue(() => {
    if (original || !overlayImage) return 0;
    return fade.get() * (live.get() >= 0 ? live.get() : staticOverlay);
  });
  const sharpenEffect = getSharpenEffect();
  const colorEffect = colorSeverities && !original ? getColorCorrectionEffect() : null;
  const colorUniforms = useMemo(
    () => colorCorrectionUniforms(colorSeverities ?? {}, 1 + (contrast - 1) * staticAmount, brightness * staticAmount),
    [colorSeverities, contrast, brightness, staticAmount],
  );
  const colorFilter = colorEffect ? <RuntimeShader source={colorEffect} uniforms={colorUniforms} /> : null;

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const transform = useDerivedValue(() => [
    { translateX: tx.get() },
    { translateY: ty.get() },
    { scale: scale.get() },
  ]);

  // A new artwork starts unzoomed.
  useEffect(() => {
    scale.set(1);
    tx.set(0);
    ty.set(0);
  }, [source, scale, tx, ty]);

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
    AccessibilityInfo.announceForAccessibility(s1 <= MIN_SCALE ? '원래 크기' : `${s1.toFixed(1)}배 확대`);
  };
  const resetZoom = () => {
    scale.set(withTiming(1));
    tx.set(withTiming(0));
    ty.set(withTiming(0));
    AccessibilityInfo.announceForAccessibility('원래 크기');
  };

  const note = !source
    ? '작품 이미지 준비 중'
    : failed
      ? '이미지를 불러오지 못했어요'
      : !image
        ? '이미지 불러오는 중…'
        : null;

  const box = (
    <View
      style={[styles.canvasBox, { backgroundColor: palette.surface, borderColor: palette.border }, style]}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${accessibilityLabel}${original ? ', 원본' : ', 보정본'}`}>
      {showLoader ? (
        <MascotLoading compact message="내 보정값을 적용하고 있어요." palette={palette} />
      ) : note ? (
        <View style={styles.center}>
          <Text style={[styles.note, { color: palette.textSecondary }]}>{note}</Text>
        </View>
      ) : (
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
              {colorFilter ? (
                sharpenEffect ? <RuntimeShader source={sharpenEffect} uniforms={sharpenUniforms}>{colorFilter}</RuntimeShader> : colorFilter
              ) : <>
                <ColorMatrix matrix={matrix} />
                {sharpenEffect ? <RuntimeShader source={sharpenEffect} uniforms={sharpenUniforms} /> : null}
              </>}
            </Image>
            {!!overlayImage && !original && (
              <Image
                image={overlayImage}
                fit="contain"
                x={0}
                y={0}
                width={size.width}
                height={size.height}
                opacity={overlayOpacity}
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}>
                <ColorMatrix matrix={matrix} />
                {sharpenEffect ? <RuntimeShader source={sharpenEffect} uniforms={sharpenUniforms} /> : null}
              </Image>
            )}
          </Group>
        </Canvas>
      )}
    </View>
  );

  if (!zoomable) return box;

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <GestureDetector gesture={gesture}>{box}</GestureDetector>
      <View style={styles.row}>
        <BigButton label="확대 +" onPress={() => zoomBy(BUTTON_STEP)} palette={palette} disabled={!image} />
        <BigButton label="축소 −" onPress={() => zoomBy(1 / BUTTON_STEP)} palette={palette} disabled={!image} />
        <BigButton label="원래 크기" onPress={resetZoom} palette={palette} selected={false} disabled={!image} />
      </View>
    </View>
  );
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontSize: FontSize.label,
    fontWeight: 600,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
});
