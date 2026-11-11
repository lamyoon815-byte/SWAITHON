import { useCallback, useEffect, useState } from 'react';
import { Image } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';

/** Wide art can follow device rotation or force landscape in the image-only viewer. */
export function useZoomOrientation(source: string | undefined, forceLandscape = false) {
  const navigation = useNavigation();
  const [measured, setMeasured] = useState<{ source: string; wide: boolean } | null>(null);
  const wide = !!source && measured?.source === source && measured.wide;

  useEffect(() => {
    if (!source) return;
    let active = true;
    Image.getSize(source, (width, height) => {
      if (active) setMeasured({ source, wide: width > height && height > 0 });
    }, () => {});
    return () => { active = false; };
  }, [source]);

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ orientation: wide ? (forceLandscape ? 'landscape' : 'default') : 'portrait' });
    // Closing the inline viewer, navigating back, and changing artworks all restore portrait.
    return () => { navigation.setOptions({ orientation: 'portrait' }); };
  }, [navigation, wide, forceLandscape]));

  return wide;
}
