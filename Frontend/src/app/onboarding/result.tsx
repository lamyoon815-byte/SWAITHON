import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { CALIBRATION } from '@/assets/images/calibration';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
import { SegmentedControl } from '@/components/common/segmented-control';
import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { Text } from '@/components/common/text';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import { formatCorrection } from '@/lib/profile-format';

const COLOR_LABELS = {
  normal: '색 보정 없음',
  protanopia: '빨강 보정',
  deuteranopia: '녹색 보정',
  tritanopia: '파랑 보정',
} as const;

/** 와이어프레임 6-1: 계정 DB에 저장한 보기 설정 확인. */
export default function CorrectionResultScreen() {
  const { profile, loaded, error, reloadProfile } = useProfile();
  const palette = getPalette('dark', profile.high_contrast);
  const ready = loaded && !error;
  const [preview, setPreview] = useState<'color' | 'edge'>('color');
  const [barHeight, setBarHeight] = useState(0);
  const calibration = profile.calibration;
  const colorType = calibration?.color_type ?? 'normal';
  const colorImage = colorType === 'normal' ? CALIBRATION.preview.deutan.artwork[0]
    : CALIBRATION.preview[colorType].artwork[Math.round((calibration?.severity ?? 0) * 5)];
  const source = preview === 'edge' ? CALIBRATION.edge.images[Math.round((calibration?.edge ?? 0) * 5)] : colorImage;
  const rows = [
    ['색 보정', profile.color_vision === 'normal' ? COLOR_LABELS.normal : `${COLOR_LABELS[profile.color_vision]} · ${Math.round(profile.color_severity * 100)}%`],
    ['윤곽선 강조', calibration ? `${Math.round(calibration.edge * 100)}%` : '설정 전'],
    ['대비', formatCorrection('contrast', profile.contrast)],
    ['밝기', formatCorrection('brightness', profile.brightness)],
    ['선명도', `${Math.round(profile.sharpen * 100)}`],
  ];
  const readjust = () => router.replace('/onboarding/calibration');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <BackButton label="보정값 다시 조절하기" palette={palette} onPress={readjust} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>내 보정값 확인</Text>
        <View style={styles.headerSpace} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barHeight + 32 }]}>
        <View style={styles.intro}>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.checkCircle, { borderColor: palette.highlight }]}>
            <View style={[styles.check, { borderColor: palette.highlight }]} />
          </View>
          <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.heading, { color: palette.text }]}>내게 맞는 보기 설정</Text>
        </View>
        {ready ? <>
          <View style={styles.previewWrapper}>
            <CorrectionCanvas
              source={source}
              accessibilityLabel={preview === 'edge' ? '윤곽선 강조 미리보기, 히로시게의 다리 위 소나기' : '색 보정 미리보기, 반 고흐의 작품'}
              correction={profile}
              palette={palette}
              style={styles.preview}
            />
            <View pointerEvents="none" style={[styles.badge, { backgroundColor: palette.background }]}>
              <Text style={[styles.badgeText, { color: palette.text }]}>보정 미리보기</Text>
            </View>
          </View>
          {calibration && <>
            <SegmentedControl accessibilityLabel="미리보기 항목" palette={palette} value={preview} onChange={setPreview}
              options={[{ value: 'color', label: '색 보정', accessibilityLabel: '색 보정 미리보기' }, { value: 'edge', label: '윤곽선', accessibilityLabel: '윤곽선 미리보기' }] as const} />
            <Text style={[styles.note, { color: palette.textSecondary }]}>색 보정과 윤곽선은 각각의 그림으로 확인해요.</Text>
          </>}
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
            <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>설정 요약</Text>
            {rows.map(([label, value], index) => <View key={label} accessible accessibilityLabel={`${label}, ${value}`} style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.outline }]}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
              <Text style={[styles.value, { color: palette.text }]}>{value}</Text>
            </View>)}
          </View>
          <Text style={[styles.note, { color: palette.textSecondary }]}>마이페이지에서 언제든 바꿀 수 있어요.</Text>
        </> : <View style={styles.state}>
          <Text accessibilityLiveRegion="polite" style={[styles.note, { color: palette.textSecondary }]}>{error ? '저장된 보정값을 불러오지 못했어요.' : '보정값을 불러오는 중이에요.'}</Text>
          {error && <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View>}
        </View>}
      </ScrollView>
      <BottomActionBar background={palette.background} onHeight={setBarHeight}>
        <View style={styles.buttonRow}><BigButton label="이 설정으로 시작하기" palette={palette} disabled={!ready} onPress={() => router.replace('/')} /></View>
        <View style={styles.buttonRow}><BigButton label="다시 맞추기" selected={false} palette={palette} disabled={!ready} onPress={readjust} /></View>
      </BottomActionBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two },
  headerSpace: { width: MinTouchTarget },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: Spacing.three },
  intro: { alignItems: 'center', gap: Spacing.two },
  heading: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 700, textAlign: 'center' },
  checkCircle: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  check: { width: 13, height: 8, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{ translateY: -2 }, { rotate: '-45deg' }] },
  previewWrapper: { position: 'relative' },
  preview: { height: 150, borderRadius: 16, borderWidth: 1.5 },
  badge: { position: 'absolute', top: Spacing.two, left: Spacing.two, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  badgeText: { fontSize: FontSize.label, fontWeight: 600 },
  card: { borderWidth: 1.5, borderRadius: 24, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  cardTitle: { fontSize: FontSize.body, fontWeight: 700, marginBottom: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: Spacing.two, rowGap: Spacing.one, paddingVertical: 12 },
  label: { fontSize: FontSize.body, lineHeight: 28 },
  value: { fontSize: FontSize.label, lineHeight: 28, fontWeight: 700, flexShrink: 1, textAlign: 'right' },
  note: { fontSize: FontSize.label, lineHeight: 27, textAlign: 'center' },
  state: { gap: Spacing.three },
  buttonRow: { flexDirection: 'row' },
});
