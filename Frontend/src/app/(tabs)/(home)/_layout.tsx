import { Stack } from 'expo-router';

// 홈 탭 안의 Stack: 1 홈 → 2 작품 감상 → 3 해설 재생. 탭 바는 계속 보인다.
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
