import { DarkTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastHost } from '@/components/common/toast';
import { AnalysisFeedbackHost } from '@/components/feedback/analysis-feedback-host';
import { Colors } from '@/constants/theme';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { useSettings } from '@/hooks/use-settings';
import { FirstLaunch } from '@/components/onboarding/first-launch';
import { getCurrentUser } from '@/lib/api';
import { updateSessionUser } from '@/store/auth';

SplashScreen.preventAutoHideAsync();

// 루트 Stack. 탭 화면은 (tabs) 안에, 탭 바 없이 전체 화면으로 띄우는 화면(1-0 미술관 선택 등)은 여기에 둔다.
export default function RootLayout() {
  const { session, loaded } = useAuth();
  const profile = useProfile();
  const { loaded: settingsLoaded } = useSettings();
  const pathname = usePathname();
  useEffect(() => {
    if (session) void getCurrentUser().then(updateSessionUser).catch(() => {});
  }, [session]);
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <ThemeProvider value={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: Colors.dark.background, card: Colors.dark.backgroundElement } }}>
        <StatusBar style="light" />
        <AnimatedSplashOverlay ready={loaded && profile.loaded && settingsLoaded} />
        {!loaded || !profile.loaded || !settingsLoaded ? (
          <View style={styles.loading}><ActivityIndicator size="large" accessibilityLabel="설정 불러오는 중" /></View>
        ) : (
          <Stack screenOptions={{ headerShown: false, orientation: 'portrait', contentStyle: { backgroundColor: Colors.dark.background } }}>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="auth" />
            </Stack.Protected>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="museum" />
              <Stack.Screen name="zoom/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
              <Stack.Screen name="capture" />
              <Stack.Screen name="search" options={{ animation: 'fade', animationDuration: 180 }} />
              <Stack.Screen name="spike" />
              <Stack.Screen name="history" />
              <Stack.Screen name="correction" />
              <Stack.Screen name="not-found" />
              <Stack.Screen name="analysis" />
              <Stack.Screen name="onboarding" />
            </Stack.Protected>
          </Stack>
        )}
        {loaded && profile.loaded && settingsLoaded && session ? <AnalysisFeedbackHost pathname={pathname} /> : null}
        <ToastHost />
        {loaded && profile.loaded && settingsLoaded && session && !pathname.startsWith('/auth') ? <FirstLaunch /> : null}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ loading: { backgroundColor: Colors.dark.background, flex: 1, alignItems: 'center', justifyContent: 'center' } });
