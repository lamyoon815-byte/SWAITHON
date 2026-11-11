import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/common/text';
import { Mustard } from '@/constants/a11y';
import { Colors } from '@/constants/theme';

/** Keep the same character and backdrop from the native launch screen to the app. */
export function AnimatedSplashOverlay({ ready = true }: { ready?: boolean }) {
  const [imageReady, setImageReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!ready || !imageReady) return;
    if (Platform.OS !== 'web') void SplashScreen.hideAsync().catch(() => {});
    const timer = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [ready, imageReady]);

  if (!visible) return null;
  return (
    <Animated.View exiting={reduceMotion ? undefined : FadeOut.duration(250)} style={styles.overlay}>
      <Image
        source={require('@/assets/images/mascot/chameleon.png')}
        contentFit="contain"
        style={styles.character}
        accessibilityLabel="MoMi 카멜레온"
        onLoad={() => setImageReady(true)}
        onError={() => setImageReady(true)}
      />
      <Text style={styles.logo}>MoMi</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: Colors.dark.background, alignItems: 'center', justifyContent: 'center', gap: 20, zIndex: 1000 },
  logo: { color: Mustard, fontSize: 36, lineHeight: 46, fontWeight: '800', letterSpacing: 1.5 },
  character: { width: 220, height: 220 },
});
