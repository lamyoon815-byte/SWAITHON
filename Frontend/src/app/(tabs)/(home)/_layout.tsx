import { Stack } from 'expo-router';

// 홈 탭 안의 Stack: 1 홈 → 2 작품 감상 → 3 해설 재생. 해설 화면에서는 AppTabs가 탭 바를 숨긴다.
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
