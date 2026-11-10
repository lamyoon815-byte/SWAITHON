/**
 * FE validation spike: run every risky library on a real device in one screen.
 * See docs/fe-spike-checklist.md for what to check and where to record results.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { A11yPanel } from '@/components/spike/a11y-panel';
import { BigButton } from '@/components/common/big-button';
import { CameraPanel } from '@/components/spike/camera-panel';
import { CorrectionCanvas } from '@/components/spike/correction-canvas';
import { LabeledSlider } from '@/components/spike/labeled-slider';
import { ResizePanel } from '@/components/spike/resize-panel';
import { Row, Section } from '@/components/spike/section';
import { TtsPanel } from '@/components/spike/tts-panel';
import { FontSize, getPalette } from '@/constants/a11y';
import { BottomTabInset } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SAMPLE = require('@/assets/images/sample/starry-night.jpg');

export default function SpikeScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [highContrast, setHighContrast] = useState(false);
  const palette = getPalette(scheme, highContrast);

  const contrast = useSharedValue(1.3);
  const brightness = useSharedValue(0.05);
  const strength = useSharedValue(1);
  const sharpen = useSharedValue(0);
  const showOriginal = useSharedValue(false);
  const [original, setOriginal] = useState(false);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          FE 검증 스파이크
        </Text>

        <Section title="1·2. 보정 · 줌 (Skia)" palette={palette}>
          <CorrectionCanvas
            source={SAMPLE}
            accessibilityLabel="빈센트 반 고흐, 별이 빛나는 밤. 확대 버튼으로 크기를 바꿀 수 있습니다."
            contrast={contrast}
            brightness={brightness}
            strength={strength}
            sharpen={sharpen}
            showOriginal={showOriginal}
            palette={palette}
          />
          <Row>
            <BigButton
              label={original ? '원본 보는 중' : '보정 보는 중'}
              onPress={() => {
                showOriginal.set(!original);
                setOriginal(!original);
              }}
              palette={palette}
              selected={!original}
              accessibilityHint="원본과 보정 이미지를 전환합니다"
            />
          </Row>
          <LabeledSlider
            label="대비"
            value={contrast}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            palette={palette}
          />
          <LabeledSlider
            label="밝기"
            value={brightness}
            min={-0.3}
            max={0.3}
            step={0.01}
            format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`}
            palette={palette}
          />
          <LabeledSlider
            label="선명도"
            value={sharpen}
            min={0}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            palette={palette}
          />
          <LabeledSlider
            label="보정 강도"
            value={strength}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            palette={palette}
          />
        </Section>

        <TtsPanel palette={palette} />
        <ResizePanel source={SAMPLE} palette={palette} />
        <A11yPanel
          palette={palette}
          highContrast={highContrast}
          onToggleHighContrast={() => setHighContrast((v) => !v)}
        />
        <CameraPanel palette={palette} />
        <View style={{ height: BottomTabInset }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: FontSize.heading + 4,
    fontWeight: 800,
  },
});
