// 와이어프레임 8 마이페이지 (담당 A. 지금은 디자인 "저시력 미술관 앱"의 미술관 기억 부분만 있음)

import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { FontSize, getPalette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseums, logout } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useViewing } from '@/hooks/use-viewing';
import { COLOR_LABELS } from '@/lib/calibration';

export default function MyPageScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const { session } = useAuth();
  const { values } = useViewing();
  const [signingOut, setSigningOut] = useState(false);
  const { settings, updateSettings } = useSettings();
  const { data: museums } = useResource('museums', getMuseums);
  const museum = museums?.find((m) => m.id === settings.recent_museum_id);

  const clearMuseum = async () => {
    await updateSettings({ recent_museum_id: null });
    showToast('미술관 기억을 지웠어요', 'success');
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await logout(); }
    catch { showToast('로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요', 'error'); }
    finally { setSigningOut(false); }
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={{ gap: Spacing.three, paddingBottom: bottomInset }}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        마이페이지
      </Text>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.value, { color: palette.text }]}>{session?.user.nickname}님</Text>
        <Text style={[styles.caption, { color: palette.textSecondary }]}>{session?.user.email}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.value, { color: palette.text }]}>내 보기 설정</Text>
        <Text style={[styles.caption, { color: palette.textSecondary }]}>
          색 보정 {COLOR_LABELS[values.color_type]} · {Math.round(values.severity * 100)}%{'\n'}
          선 굵기 {Math.round(values.edge * 100)}% · 대비 {Math.round(values.contrast * 100)}%
        </Text>
        <Text style={[styles.caption, { color: palette.textSecondary }]}>이 기기에 저장돼요.</Text>
      </View>
      <View style={styles.row}>
        <BigButton label="보기 설정 세부 조정" palette={palette} onPress={() => router.push('/mypage/correction')} />
      </View>
      <View style={styles.row}>
        <BigButton label="보정값 다시 맞추기" selected={false} palette={palette} onPress={() => router.push('/onboarding')} />
      </View>

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
      <View style={styles.row}>
        <BigButton label={signingOut ? '로그아웃 중…' : '로그아웃'} selected={false} palette={palette} disabled={signingOut} onPress={signOut} />
      </View>
      </ScrollView>
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
