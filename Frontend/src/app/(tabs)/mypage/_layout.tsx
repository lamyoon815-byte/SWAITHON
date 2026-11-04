import { Stack } from 'expo-router';

// 마이페이지 탭 안의 Stack: 8 마이페이지 → 8-1 내 보정값 세부 조정.
export default function MyPageLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
