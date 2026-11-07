// 와이어프레임 1-0 미술관 선택
/**
 * 탭 바 없이 전체 화면. 고르면 기기에 기억해 두고(다음 실행 때 홈 카드에 표시) 홈으로 돌아간다.
 * 홈에서 번호 입력을 하려다 들어왔으면(`?next=number`) 돌아가서 번호 입력칸에 바로 커서를 둔다.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { ButtonRadius, FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { MuseumNext } from '@/types/museum';

const NEXT_LABEL: Record<MuseumNext, string> = { number: '번호 입력', list: '작품 목록' };

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function MuseumScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const { next } = useLocalSearchParams<{ next?: MuseumNext }>();
  const { settings, updateSettings } = useSettings();
  const { data: museums } = useResource('museums-with-counts', async () => {
    const list = await getMuseums();
    return Promise.all(
      list.map(async (m) => ({ ...m, count: (await getMuseumArtworks(m.id)).length })),
    );
  });

  const pick = async (id: string) => {
    await updateSettings({ recent_museum_id: id });
    if (next === 'number') router.dismissTo({ pathname: '/', params: { focus: 'number' } });
    else goBack();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackButton label="뒤로" palette={palette} onPress={goBack} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          미술관을 선택해 주세요
        </Text>
        {next && NEXT_LABEL[next] && (
          <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
            선택하면 {NEXT_LABEL[next]} 화면으로 이어져요
          </Text>
        )}
        <View style={styles.list}>
          {museums?.map((m) => {
            const current = m.id === settings.recent_museum_id;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, ${m.area}, 작품 ${m.count}점`}
                accessibilityState={{ selected: current }}
                onPress={() => pick(m.id)}
                style={({ pressed }) => [
                  styles.item,
                  {
                    backgroundColor: palette.surface,
                    borderColor: current ? palette.accent : palette.fill,
                    borderWidth: current ? 3 : 2,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <View style={styles.itemTexts}>
                  <Text style={[styles.name, { color: palette.text }]}>{m.name}</Text>
                  <Text style={[styles.meta, { color: palette.textSecondary }]}>
                    {m.area} · 작품 {m.count}점
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: current ? palette.fill : palette.accent,
                    },
                  ]}>
                  <Text
                    style={[styles.pillText, { color: current ? palette.text : palette.accentText }]}>
                    {current ? '✓ 현재' : '선택'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  title: {
    marginTop: 20,
    fontSize: FontSize.heading,
    fontWeight: 800,
    lineHeight: 34,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
  list: {
    marginTop: Spacing.four,
    gap: 12,
  },
  item: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 20,
    paddingRight: 14,
    borderRadius: 24,
  },
  itemTexts: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: FontSize.label,
    fontWeight: 800,
    lineHeight: 24,
  },
  meta: {
    fontSize: 16,
    fontWeight: 500,
  },
  // Fixed width so "✓ 현재" and "선택" line up down the list instead of following their text.
  pill: {
    width: 96,
    minHeight: 44,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 16,
    fontWeight: 800,
  },
});
