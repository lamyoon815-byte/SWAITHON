// 와이어프레임 1-0 미술관 선택
/**
 * 탭 바 없이 전체 화면. 고르면 기기에 기억해 두고(다음 실행 때 홈 카드에 표시) 홈으로 돌아간다.
 * 검색 화면에서 들어왔으면(`?next=number`) 고른 뒤 검색 화면으로 돌아가 이어서 번호를 입력한다.
 * 누르면 카드가 살짝 눌렸다 돌아오고 "✓ 선택됨"으로 바뀐 걸 잠깐(0.6초) 보여 준 뒤 돌아간다.
 * 바로 넘어가면 무엇을 골랐는지 느낄 틈이 없어서다. 돌아간 화면에는 확인 토스트를 띄운다.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { showToast } from '@/components/common/toast';
import { ButtonRadius, FontSize, getPalette, type Palette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResource } from '@/hooks/use-resource';
import { useSettings } from '@/hooks/use-settings';
import { getMuseumArtworks, getMuseums } from '@/lib/api';
import type { Museum, MuseumNext } from '@/types/museum';

/** "✓ 선택됨"을 보여 주는 시간. 눌렀다는 느낌은 들고, 기다린다는 느낌은 들지 않을 만큼. */
const ConfirmMs = 600;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const NEXT_LABEL: Record<MuseumNext, string> = { number: '작품 찾기', list: '작품 목록' };

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

  const [picked, setPicked] = useState<string | null>(null);

  const pick = async (m: Museum) => {
    if (picked) return; // one choice at a time; ignore taps during the confirmation
    setPicked(m.id);
    AccessibilityInfo.announceForAccessibility(`${m.name} 선택됨`);
    await Promise.all([
      updateSettings({ recent_museum_id: m.id }),
      new Promise((r) => setTimeout(r, ConfirmMs)),
    ]);
    // Back to wherever we came from: the search screen (next=number) or home.
    goBack();
    showToast(`${m.name}으로 바꿨어요`, 'success');
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
          {museums?.map((m) => (
            <MuseumRow
              key={m.id}
              museum={m}
              current={picked ? m.id === picked : m.id === settings.recent_museum_id}
              justPicked={m.id === picked}
              palette={palette}
              onPress={() => pick(m)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type RowProps = {
  museum: Museum & { count: number };
  current: boolean;
  justPicked: boolean;
  palette: Palette;
  onPress: () => void;
};

function MuseumRow({ museum: m, current, justPicked, palette, onPress }: RowProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const pressIn = () => {
    if (!reduceMotion) scale.set(withTiming(0.97, { duration: 90 }));
  };
  // On release: back to size with a small overshoot, so the choice feels "set".
  const pressOut = () => {
    if (!reduceMotion)
      scale.set(withSequence(withSpring(1.015, { damping: 12, stiffness: 400 }), withSpring(1)));
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${m.name}, ${m.area}, 작품 ${m.count}점`}
      accessibilityState={{ selected: current }}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={onPress}
      style={[
        styles.item,
        {
          backgroundColor: justPicked ? palette.fill : palette.surface,
          borderColor: current ? palette.accent : palette.fill,
          borderWidth: current ? 3 : 2,
        },
        pressStyle,
      ]}>
      <View style={styles.itemTexts}>
        <Text style={[styles.name, { color: palette.text }]}>{m.name}</Text>
        <Text style={[styles.meta, { color: palette.textSecondary }]}>
          {m.area} · 작품 {m.count}점
        </Text>
      </View>
      {/* Keyed so the new label fades in instead of just swapping. Fixed width: nothing shifts. */}
      <Animated.View
        key={justPicked ? 'picked' : current ? 'current' : 'pick'}
        entering={justPicked ? FadeIn.duration(180).reduceMotion(ReduceMotion.System) : undefined}
        style={[
          styles.pill,
          {
            backgroundColor: justPicked
              ? palette.highlight
              : current
                ? palette.fill
                : palette.accent,
          },
        ]}>
        <Text
          style={[
            styles.pillText,
            {
              color: justPicked
                ? palette.highlightText
                : current
                  ? palette.text
                  : palette.accentText,
            },
          ]}>
          {justPicked ? '✓ 선택됨' : current ? '✓ 현재' : '선택'}
        </Text>
      </Animated.View>
    </AnimatedPressable>
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
