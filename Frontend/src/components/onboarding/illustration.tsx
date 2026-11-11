import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/common/text';
import { FontSize, type Palette } from '@/constants/a11y';
import type { ONBOARDING_SLIDES } from '@/constants/onboarding';

type Kind = (typeof ONBOARDING_SLIDES)[number]['artwork'];
const MASCOT = require('@/assets/images/mascot/chameleon.png');
const SAMPLE = require('@/assets/images/sample/starry-night.jpg');

export function OnboardingIllustration({ kind, palette }: { kind: Kind; palette: Palette }) {
  const frame = { borderColor: palette.outline, backgroundColor: palette.surface };
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.scene}>
      {kind === 'welcome' ? (
        <Image source={MASCOT} contentFit="contain" style={styles.welcomeMascot} />
      ) : kind === 'start' ? (
        <View style={styles.comparison}>
          {['A', 'B'].map((label, index) => (
            <View style={styles.option} key={label}>
              <View style={[styles.smallFrame, frame, index === 0 && { borderColor: palette.highlight }]}>
                <Image source={SAMPLE} contentFit="cover" style={[styles.image, { opacity: index === 0 ? 1 : 0.5 }]} />
                {index === 0 && <View style={[styles.checkBadge, { backgroundColor: palette.highlight }]}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={20} weight="bold" tintColor={palette.highlightText} /></View>}
              </View>
              <Text style={[styles.letter, { color: palette.textSecondary }]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          <View style={[styles.frame, frame]}>
            <Image source={SAMPLE} contentFit="cover" style={[styles.image, { opacity: 0.9 }]} />
          </View>
          {kind === 'correction' && <View style={[styles.sliders, { backgroundColor: palette.background }]}>
            {[0.7, 0.5, 0.35].map((position, index) => <View key={index} style={[styles.track, { backgroundColor: palette.outline }]}><View style={[styles.thumb, { left: `${position * 100}%`, backgroundColor: palette.highlight }]} /></View>)}
          </View>}
          {kind === 'narration' && <>
            <View style={[styles.headphones, { backgroundColor: palette.background }]}><SymbolView name={{ ios: 'headphones', android: 'headphones', web: 'headphones' }} size={90} tintColor={palette.text} /></View>
            <View style={styles.wave}>{[12, 24, 42, 28, 16].map((height, index) => <View key={index} style={[styles.waveLine, { height, backgroundColor: palette.highlight }]} />)}</View>
          </>}
        </>
      )}
      {kind !== 'welcome' && <Image source={MASCOT} contentFit="contain" style={styles.companion} />}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: '100%', maxWidth: 300, height: 240, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  frame: { width: 226, height: 186, padding: 8, borderWidth: 2, borderRadius: 12, marginBottom: 24 },
  welcomeMascot: { width: 260, height: 240 },
  companion: { position: 'absolute', width: 104, height: 112, left: -4, bottom: -8 },
  image: { width: '100%', height: '100%', borderRadius: 6 },
  sliders: { width: 184, gap: 14, padding: 12, position: 'absolute', bottom: 0, borderRadius: 12 },
  track: { width: '100%', height: 3, borderRadius: 2 },
  thumb: { position: 'absolute', top: -4, width: 11, height: 11, borderRadius: 6, marginLeft: -5 },
  headphones: { position: 'absolute', right: 0, bottom: 4, borderRadius: 36, padding: 4 },
  wave: { position: 'absolute', right: 3, top: 20, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  waveLine: { width: 4, borderRadius: 2 },
  comparison: { width: '100%', flexDirection: 'row', gap: 16, paddingHorizontal: 8 },
  option: { flex: 1, alignItems: 'center', gap: 8 },
  smallFrame: { width: '100%', height: 150, padding: 6, borderRadius: 16, borderWidth: 3 },
  checkBadge: { position: 'absolute', top: -14, right: -8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: FontSize.label, fontWeight: 700 },
});
