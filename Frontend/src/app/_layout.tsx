import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastHost } from '@/components/common/toast';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { useSettings } from '@/hooks/use-settings';
import { getCurrentUser } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

// 루트 Stack. 탭 화면은 (tabs) 안에, 탭 바 없이 전체 화면으로 띄우는 화면(1-0 미술관 선택 등)은 여기에 둔다.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loaded } = useAuth();
  const profile = useProfile();
  const { settings, loaded: settingsLoaded } = useSettings();
  useEffect(() => {
    if (session) void getCurrentUser().catch(() => {});
  }, [session]);
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {!loaded || !profile.loaded || !settingsLoaded ? (
          <View style={styles.loading}><ActivityIndicator size="large" accessibilityLabel="설정 불러오는 중" /></View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="auth" />
            </Stack.Protected>
            <Stack.Protected guard={!!session}>
              <Stack.Protected guard={settings.onboarding_completed}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="museum" />
                <Stack.Screen name="zoom/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                <Stack.Screen name="capture" />
                <Stack.Screen name="search" options={{ animation: 'fade', animationDuration: 180 }} />
                <Stack.Screen name="spike" />
                <Stack.Screen name="history" />
                <Stack.Screen name="correction" />
                <Stack.Screen name="not-found" />
              </Stack.Protected>
              <Stack.Screen name="onboarding" />
            </Stack.Protected>
          </Stack>
        )}
        <ToastHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
