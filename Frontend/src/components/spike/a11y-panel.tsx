/**
 * Spike: system font scale, OS accessibility settings, high-contrast tokens.
 * Change system settings while the app is open — values update live.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, useWindowDimensions } from 'react-native';
import { Text } from '@/components/common/text';

import { BigButton } from '@/components/common/big-button';
import { InfoText, Row, Section } from '@/components/spike/section';
import { FontSize, type Palette } from '@/constants/a11y';

type Flags = Record<string, boolean | null>;

async function readFlags(): Promise<Flags> {
  const probe = (fn: () => Promise<boolean>) => fn().catch(() => null);
  const [screenReader, boldText, reduceMotion, highTextContrast, darkerColors] = await Promise.all([
    probe(AccessibilityInfo.isScreenReaderEnabled),
    probe(AccessibilityInfo.isBoldTextEnabled),
    probe(AccessibilityInfo.isReduceMotionEnabled),
    Platform.OS === 'android' ? probe(AccessibilityInfo.isHighTextContrastEnabled) : null,
    Platform.OS === 'ios' ? probe(AccessibilityInfo.isDarkerSystemColorsEnabled) : null,
  ]);
  return {
    '스크린리더': screenReader,
    '굵은 텍스트': boldText,
    '동작 줄이기': reduceMotion,
    '고대비 텍스트(Android)': highTextContrast,
    '대비 증가(iOS)': darkerColors,
  };
}

type Props = {
  palette: Palette;
  highContrast: boolean;
  onToggleHighContrast: () => void;
};

export function A11yPanel({ palette, highContrast, onToggleHighContrast }: Props) {
  const { fontScale } = useWindowDimensions();
  const [flags, setFlags] = useState<Flags>({});

  useEffect(() => {
    const refresh = () => {
      readFlags().then(setFlags);
    };
    refresh();
    const subs = [
      AccessibilityInfo.addEventListener('screenReaderChanged', refresh),
      AccessibilityInfo.addEventListener('boldTextChanged', refresh),
      AccessibilityInfo.addEventListener('reduceMotionChanged', refresh),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <Section title="5. 큰 글씨 · 고대비 · 스크린리더" palette={palette}>
      <InfoText palette={palette}>시스템 글꼴 배율: {fontScale.toFixed(2)}x</InfoText>
      {Object.entries(flags)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => (
          <InfoText key={k} palette={palette}>
            {k}: {v ? '켜짐' : '꺼짐'}
          </InfoText>
        ))}
      <Text style={{ fontSize: FontSize.body, color: palette.text }}>
        본문 {FontSize.body}pt — 시스템 배율을 따라 커집니다.
      </Text>
      <Text style={{ fontSize: FontSize.body, color: palette.text }} maxFontSizeMultiplier={1.5}>
        상한 1.5배 — 버튼처럼 공간이 좁은 곳에 쓸 후보입니다.
      </Text>
      <Row>
        <BigButton
          label={highContrast ? '고대비 켜짐' : '고대비 꺼짐'}
          onPress={onToggleHighContrast}
          palette={palette}
          selected={highContrast}
        />
      </Row>
    </Section>
  );
}
