// 와이어프레임 8 마이페이지 (담당 A. 지금은 디자인 "저시력 미술관 앱"의 미술관 기억 부분만 있음)

import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { FontSize, getPalette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseums } from '@/lib/api';

export default function MyPageScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const { settings, updateSettings } = useSettings();
  const { data: museums } = useResource('museums', getMuseums);
  const museum = museums?.find((m) => m.id === settings.recent_museum_id);

  const clearMuseum = async () => {
    await updateSettings({ recent_museum_id: null });
    showToast('미술관 기억을 지웠어요');
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.screen, { backgroundColor: palette.background, paddingBottom: bottomInset }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        마이페이지
      </Text>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.caption, { color: palette.textSecondary }]}>마지막으로 선택한 미술관</Text>
        <Text style={[styles.value, { color: palette.text }]}>{museum?.name ?? '없음'}</Text>
      </View>
      {/* BigButton grows to fill its parent, so each one gets a row of its own. */}
      <View style={styles.row}>
        <BigButton
          label="미술관 기억 지우기"
          palette={palette}
          selected={false}
          disabled={!museum}
          onPress={clearMuseum}
        />
      </View>

      {__DEV__ && (
        <View style={styles.row}>
          <BigButton label="기술 검증 (개발용)" palette={palette} onPress={() => router.navigate('/spike')} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 800,
  },
  card: {
    gap: Spacing.one,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  caption: {
    fontSize: 16,
    fontWeight: 600,
  },
  value: {
    fontSize: FontSize.body,
    fontWeight: 800,
  },
});
