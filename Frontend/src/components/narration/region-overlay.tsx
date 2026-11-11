/**
 * 해설 화면에서 작품 위에 영역 상자를 그린다(서버 description.regions, 0~1 비율 bbox).
 * 상자를 누르면 그 영역을 설명하는 문장으로 옮겨 간다. 지금 읽는 문장의 영역은 머스타드 굵은 테두리.
 * 이름표 글씨는 두지 않는다(확대하면 잘리고 그림을 가린다). 영역 이름은 스크린리더 이름과 문장으로 전한다.
 * 그림은 상자 안에 비율대로(contain) 그려지므로, 원본 크기를 받아 실제 그림이 놓인 자리에 맞춘다.
 * 그림 전체에 가까운 영역(배경 등)은 다른 상자를 가리므로 누를 수 있게 그리지 않는다.
 */

import { useEffect, useState } from 'react';
import { Image as NativeImage, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { Palette } from '@/constants/a11y';
import type { Region } from '@/types/artwork';

type Props = {
  imageUri: string;
  regions: Region[];
  /** 문장이 하나라도 가리키는 영역 번호만 그린다 */
  usable: Set<number>;
  active: number | null;
  /** 캔버스 테두리 두께(그림은 테두리 안쪽에 그려진다) */
  inset?: number;
  palette: Palette;
  onPressRegion: (index: number) => void;
};

export function RegionOverlay({ imageUri, regions, usable, active, inset = 1.5, palette, onPressRegion }: Props) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState<{ uri: string; value: number } | null>(null);

  useEffect(() => {
    let alive = true;
    NativeImage.getSize(imageUri, (w, h) => { if (alive && w > 0 && h > 0) setRatio({ uri: imageUri, value: w / h }); }, () => {});
    return () => { alive = false; };
  }, [imageUri]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox({ width: width - inset * 2, height: height - inset * 2 });
  };

  const imageRatio = ratio?.uri === imageUri ? ratio.value : null;
  // 상자 안에서 그림이 실제로 차지하는 영역(contain).
  const fit = imageRatio && box.width > 0 && box.height > 0
    ? imageRatio > box.width / box.height
      ? { width: box.width, height: box.width / imageRatio }
      : { width: box.height * imageRatio, height: box.height }
    : null;
  const left = fit ? inset + (box.width - fit.width) / 2 : 0;
  const top = fit ? inset + (box.height - fit.height) / 2 : 0;

  // 큰 영역부터 그려서 작은 영역이 위에 놓이게(작은 것도 누를 수 있게).
  const order = regions
    .map((region, index) => ({ region, index, area: region.bbox[2] * region.bbox[3] }))
    .filter(({ index, area }) => usable.has(index) && area < 0.85)
    .sort((a, b) => b.area - a.area);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {fit && order.map(({ region, index }) => {
        const [x, y, w, h] = region.bbox;
        const on = index === active;
        return (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`${region.label} 부분 설명 듣기`}
            accessibilityState={{ selected: on }}
            onPress={() => onPressRegion(index)}
            style={({ pressed }) => [styles.region, {
              left: left + x * fit.width,
              top: top + y * fit.height,
              width: w * fit.width,
              height: h * fit.height,
              borderColor: on ? palette.highlight : 'rgba(255,255,255,0.75)',
              borderWidth: on ? 4 : 2,
              backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'transparent',
            }]} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  region: { position: 'absolute', borderRadius: 10, borderStyle: 'solid' },
});
