import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { StatusBar } from 'expo-status-bar';

import { CorrectionCanvas } from '@/components/common/correction-canvas';
import { PressableScale } from '@/components/common/pressable-scale';
import { Text } from '@/components/common/text';
import { getPalette, MinTouchTarget } from '@/constants/a11y';
import { useCorrectedArtwork } from '@/hooks/use-corrected-artwork';
import { useZoomOrientation } from '@/hooks/use-zoom-orientation';
import { viewingFromProfile } from '@/lib/calibration';
import type { Artwork } from '@/types/artwork';
import type { VisualProfile } from '@/types/profile';

type Props = {
  artwork: Artwork | null;
  profile: VisualProfile;
  original: boolean;
  strength: number;
  imageError?: string;
  onClose: () => void;
};

/** Image-only viewing: wide art forces landscape, independent of the phone's tilt. */
export function ArtworkFullscreenView({ artwork, profile, original, strength, imageError, onClose }: Props) {
  useZoomOrientation(artwork?.image_url, true);
  const insets = useSafeAreaInsets();
  const palette = getPalette('dark', false);
  const corrected = useCorrectedArtwork(artwork?.id, artwork?.image_url, viewingFromProfile(profile), original, strength, undefined);

  return <GestureHandlerRootView style={styles.screen}>
    <StatusBar hidden />
    {artwork ? <CorrectionCanvas
      source={corrected.source}
      overlay={corrected.overlay}
      overlayAmount={corrected.overlayAmount}
      waiting={corrected.loading}
      accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
      correction={{ ...profile, strength }}
      original={original}
      zoomable
      showZoomControls={false}
      palette={palette}
      containerStyle={styles.screen}
      style={styles.canvas}
    /> : <View style={styles.screen}>
      {!!imageError && <Text accessibilityRole="alert" style={styles.error}>{imageError}</Text>}
    </View>}
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="전체 보기 닫기"
      accessibilityHint="세로 화면으로 돌아가요"
      onPress={onClose}
      style={[styles.close, { top: insets.top + 8, right: Math.max(insets.right, 12) }]}>
      <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={24} tintColor="#FFFFFF" />
    </PressableScale>
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  canvas: { flex: 1, height: undefined, borderWidth: 0, borderRadius: 0, backgroundColor: '#000000' },
  close: {
    position: 'absolute', minWidth: MinTouchTarget, minHeight: MinTouchTarget,
    borderRadius: MinTouchTarget / 2, backgroundColor: '#00000099', alignItems: 'center', justifyContent: 'center',
  },
  error: { color: '#FFFFFF', padding: 24, textAlign: 'center' },
});
