import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastHost } from '@/components/common/toast';
import { FirstLaunch } from '@/components/onboarding/first-launch';
import { useColorScheme } from '@/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

// 루트 Stack. 탭 화면은 (tabs) 안에, 탭 바 없이 전체 화면으로 띄우는 화면(1-0 미술관 선택 등)은 여기에 둔다.
// 로그인 없이, 홈 첫 실행 시 FirstLaunch에서 온보딩으로 보낸다.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="museum" />
          <Stack.Screen
            name="zoom/[id]"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen name="capture" />
          {/* Quick fade (default is 500ms on iOS, which felt slow). animationDuration is iOS-only. */}
          <Stack.Screen name="search" options={{ animation: 'fade', animationDuration: 180 }} />
          <Stack.Screen name="spike" />
        </Stack>
        <ToastHost />
        <FirstLaunch />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
