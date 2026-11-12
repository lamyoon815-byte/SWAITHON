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
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { SymbolView } from 'expo-symbols';

import { BigButton } from '@/components/common/big-button';
import { PressableScale } from '@/components/common/pressable-scale';
import { MascotLoading } from '@/components/common/mascot-loading';
import { useCanvasImage } from '@/hooks/use-canvas-image';
import { FontSize, type Palette } from '@/constants/a11y';
import { correctionMatrix } from '@/lib/color-matrix';
import { FOLLOW_FILL, FOLLOW_MAX } from '@/lib/follow-zoom';
import { colorCorrectionUniforms, getColorCorrectionEffect } from '@/lib/color-correction';
import { getSharpenEffect } from '@/lib/sharpen';
import { getToneEffect, lumaHistogram, toneUniforms } from '@/lib/tone-curve';
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
  /** 따라 확대할 영역(그림 기준 0~1 비율 [x, y, w, h]). null이면 원래 크기로, 주지 않으면 확대 상태를 건드리지 않는다 */
  focus?: readonly [number, number, number, number] | null;
  /** Hide buttons in the immersive landscape viewer; pinch and double-tap still work. */
  showZoomControls?: boolean;
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
  focus,
  showZoomControls = true,
  palette,
  style,
  containerStyle,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const { image, failed: sourceFailed } = useCanvasImage(source || null, attempt);
  const { image: overlayImage, failed: overlayFailed } = useCanvasImage(overlay || null, attempt);
  // The corrected picture fades in over the original when it arrives (no blank box, no hard jump).
  const fade = useSharedValue(0);
  // A screen that waits for the corrected picture shows it at full strength at once (no original flash).
  const waitsForOverlay = waiting !== undefined;
  useEffect(() => {
    fade.set(overlayImage ? (waitsForOverlay ? 1 : withTiming(1, { duration: 250 })) : 0);
  }, [overlayImage, fade, waitsForOverlay]);
  // Keep the chameleon until the corrected picture is decoded, not just downloaded.
  const failed = sourceFailed || (!original && !!overlay && overlayFailed);
  const showLoader = !failed && (!image || (!original && (!!waiting || (waitsForOverlay && !!overlay && !overlayImage))));

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
  // 대비는 그림의 밝기 분포에 맞춘 곡선으로 적용한다(어두운 그림이 검게 뭉개지지 않게, tone-curve.ts).
  const histogram = useMemo(() => (image ? lumaHistogram(image) : null), [image]);
  const toneEffect = getToneEffect();
  const tone = useDerivedValue(() => {
    const amount = original ? 0 : live.get() >= 0 ? live.get() : staticAmount;
    return toneUniforms(contrast, brightness, amount, histogram);
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
    // 대비 셰이더가 있으면 대비·밝기는 그쪽에서 적용하고, 여기서는 색 보정만 한다.
    () => toneEffect
      ? colorCorrectionUniforms(colorSeverities ?? {}, 1, 0)
      : colorCorrectionUniforms(colorSeverities ?? {}, 1 + (contrast - 1) * staticAmount, brightness * staticAmount),
    [colorSeverities, contrast, brightness, staticAmount, toneEffect],
  );
  const colorShader = colorEffect ? <RuntimeShader source={colorEffect} uniforms={colorUniforms} /> : null;
  // 색 보정 → 대비 순서 (안쪽이 먼저 적용된다)
  const colorFilter = colorShader && toneEffect
    ? <RuntimeShader source={toneEffect} uniforms={tone}>{colorShader}</RuntimeShader>
    : colorShader;
  const toneFilter = toneEffect ? <RuntimeShader source={toneEffect} uniforms={tone} /> : <ColorMatrix matrix={matrix} />;

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

  // 따라 확대: 읽는 문장의 영역으로 부드럽게 확대·이동한다(동작 줄이기면 바로 옮긴다).
  const reduceMotion = useReducedMotion();
  const fx = focus?.[0], fy = focus?.[1], fw = focus?.[2], fh = focus?.[3];
  const imageW = image?.width() ?? 0;
  const imageH = image?.height() ?? 0;
  useEffect(() => {
    if (focus === undefined) return;
    const move = (value: number) => (reduceMotion ? value : withTiming(value, { duration: 600, easing: Easing.inOut(Easing.cubic) }));
    const W = size.width, H = size.height;
    if (fx === undefined || fy === undefined || fw === undefined || fh === undefined || !W || !H || !imageW || !imageH) {
      scale.set(move(1)); tx.set(move(0)); ty.set(move(0));
      return;
    }
    // 그림은 상자 안에 contain으로 그려지므로 실제 그림 자리를 기준으로 영역을 잡는다.
    const r = Math.min(W / imageW, H / imageH);
    const pw = imageW * r, ph = imageH * r;
    const ox = (W - pw) / 2, oy = (H - ph) / 2;
    const s = clamp(Math.min(FOLLOW_MAX, (FOLLOW_FILL * W) / Math.max(1, fw * pw), (FOLLOW_FILL * H) / Math.max(1, fh * ph)), MIN_SCALE, MAX_SCALE);
    const cx = ox + (fx + fw / 2) * pw;
    const cy = oy + (fy + fh / 2) * ph;
    scale.set(move(s));
    tx.set(move(clampTranslate(W / 2 - cx * s, W, s)));
    ty.set(move(clampTranslate(H / 2 - cy * s, H, s)));
  }, [focus === undefined, fx, fy, fw, fh, size.width, size.height, imageW, imageH, reduceMotion, scale, tx, ty]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const box = (
    <View
      style={[styles.canvasBox, { backgroundColor: palette.surface, borderColor: palette.border }, style]}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${accessibilityLabel}${original ? ', 원본' : ', 보정본'}`}>
      {showLoader ? (
        <MascotLoading compact message={!image ? '이미지를 불러오고 있어요.' : '내 보정값을 적용하고 있어요.'} palette={palette} />
      ) : failed ? (
        <View style={styles.center}>
          <Text style={[styles.note, { color: palette.textSecondary }]}>이미지를 불러오지 못했어요</Text>
          <View style={styles.row}><BigButton label="다시 불러오기" palette={palette} onPress={() => setAttempt((value) => value + 1)} /></View>
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
                {toneFilter}
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
                {toneFilter}
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
      {/* 확대·축소·원래 크기: 그림을 덜 가리게 오른쪽에 작은 동그라미로 세로로 둔다. */}
      {showZoomControls && <View pointerEvents="box-none" style={styles.side}>
        {([
          { label: '확대', icon: { ios: 'plus', android: 'add', web: 'add' }, onPress: () => zoomBy(BUTTON_STEP) },
          { label: '축소', icon: { ios: 'minus', android: 'remove', web: 'remove' }, onPress: () => zoomBy(1 / BUTTON_STEP) },
          { label: '원래 크기', icon: { ios: 'arrow.counterclockwise', android: 'restart_alt', web: 'restart_alt' }, onPress: resetZoom },
        ] as const).map((button) => (
          <PressableScale key={button.label} accessibilityRole="button" accessibilityLabel={button.label}
            accessibilityState={{ disabled: !image }} disabled={!image} onPress={button.onPress}
            style={({ pressed }) => [styles.sideButton, { borderColor: palette.border, opacity: !image ? 0.4 : pressed ? 0.7 : 1 }]}>
            <SymbolView name={button.icon} size={22} weight="bold" tintColor="#FFFFFF" />
          </PressableScale>
        ))}
      </View>}
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
    gap: 12,
    padding: 16,
  },
  note: {
    fontSize: FontSize.label,
    fontWeight: 600,
  },
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 12,
    justifyContent: 'center',
    gap: 10,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    // 밝은 그림 위에서도 보이게 반투명 검정 바탕
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  // 이미지를 못 불러왔을 때 "다시 불러오기" 버튼 줄.
  row: {
    flexDirection: 'row',
    gap: 8,
  },
});
