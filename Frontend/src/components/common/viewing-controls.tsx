import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { CALIBRATION } from '@/assets/images/calibration';
import { BigButton } from '@/components/common/big-button';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { FontSize, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { COLOR_LABELS, type ColorType, type ViewingProfile } from '@/lib/calibration';

export function ColorChoices({ value, onChange, palette }: {
  value: ColorType | null; onChange: (type: ColorType) => void; palette: Palette;
}) {
  return <View style={styles.group}>
    {(Object.keys(COLOR_LABELS) as ColorType[]).map((type) => <View key={type} style={styles.row}>
      <BigButton label={COLOR_LABELS[type]} palette={palette} radio selected={type === value} onPress={() => onChange(type)} />
    </View>)}
  </View>;
}

export function ValueSlider({ label, value, min, max, step, display, onChange, palette }: {
  label: string; value: number; min: number; max: number; step: number; display: string;
  onChange: (n: number) => void; palette: Palette;
}) {
  return <View style={styles.group}>
    <Text style={[styles.label, { color: palette.text }]}>{label} · {display}</Text>
    <Slider accessibilityLabel={label} accessibilityValue={{ min, max, now: value, text: display }}
      minimumValue={min} maximumValue={max} step={step} value={value}
      minimumTrackTintColor={palette.accent} maximumTrackTintColor={palette.border} thumbTintColor={palette.accent}
      style={styles.slider} onValueChange={(n) => onChange(Math.round(n * 100) / 100)} />
  </View>;
}

export function ViewingControls({ value, onChange, palette }: {
  value: ViewingProfile; onChange: (value: ViewingProfile) => void; palette: Palette;
}) {
  const color = value.color_type === 'normal' ? null : CALIBRATION.preview[value.color_type];
  const index = Math.min(5, Math.max(0, Math.round(value.severity * 5)));
  const edgeIndex = Math.min(5, Math.max(0, Math.round(value.edge * 5)));
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={[styles.label, { color: palette.text }]}>색 구분 보정 종류</Text>
    <ColorChoices value={value.color_type} palette={palette}
      onChange={(color_type) => onChange({ ...value, color_type, severity: color_type === 'normal' ? 0 : value.severity })} />
    {color && <>
      <ValueSlider label="색 보정 세기" value={value.severity} min={0} max={1} step={0.2}
        display={`${Math.round(value.severity * 100)}%`} palette={palette} onChange={(severity) => onChange({ ...value, severity })} />
      <Text style={[styles.caption, { color: palette.textSecondary }]}>색 보정 미리보기 · 검사판과 작품</Text>
      <Image source={color.plate[index]} accessibilityLabel="선택한 색 보정의 숫자 검사판" style={styles.preview} contentFit="contain" />
      <Image source={color.artwork[index]} accessibilityLabel="선택한 색 보정의 작품 미리보기" style={styles.preview} contentFit="contain" />
    </>}
    <ValueSlider label="선 굵기" value={value.edge} min={0} max={1} step={0.2}
      display={`${Math.round(value.edge * 100)}%`} palette={palette} onChange={(edge) => onChange({ ...value, edge })} />
    <Text style={[styles.caption, { color: palette.textSecondary }]}>윤곽선 미리보기 · 빗줄기와 다리</Text>
    <Image source={CALIBRATION.edge.images[edgeIndex]} accessibilityLabel="선 굵기 미리보기" style={styles.preview} contentFit="contain" />
    <Text style={[styles.caption, { color: palette.textSecondary }]}>밝기·대비·선명도 미리보기</Text>
    <CorrectionCanvas source={CALIBRATION.contrast.image} accessibilityLabel="흰 옷과 커튼의 밝기와 대비"
      correction={{ contrast: value.contrast, brightness: value.brightness, sharpen: value.sharpness, strength: 1 }} palette={palette} />
    <ValueSlider label="대비" value={value.contrast} min={0.5} max={2} step={0.01}
      display={`${Math.round(value.contrast * 100)}%`} palette={palette} onChange={(contrast) => onChange({ ...value, contrast })} />
    <ValueSlider label="밝기" value={value.brightness} min={-1} max={1} step={0.01}
      display={`${Math.round(value.brightness * 100)}`} palette={palette} onChange={(brightness) => onChange({ ...value, brightness })} />
    <ValueSlider label="선명도" value={value.sharpness} min={0} max={2} step={0.1}
      display={`${Math.round(value.sharpness * 100)}%`} palette={palette} onChange={(sharpness) => onChange({ ...value, sharpness })} />
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two }, row: { flexDirection: 'row' },
  label: { fontSize: FontSize.label, fontWeight: '700', lineHeight: 30 },
  caption: { fontSize: 18, lineHeight: 26 }, slider: { height: 56, width: '100%' },
  preview: { width: '100%', height: 260 },
});
