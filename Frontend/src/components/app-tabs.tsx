/**
 * Bottom tab bar: 홈 · 카메라 · 마이 (design "저시력 미술관 앱").
 * A pill floating above the content; the selected tab gets a filled mustard pill behind it,
 * so selection is shown by shape and contrast, not by color alone. (The design's gray pill is
 * near-invisible on the light bar, about 1.2:1, so both modes use the highlight color.)
 * Screens pad their bottom with `useTabBarInset()` so nothing hides behind it.
 */

import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getPalette, type Palette } from '@/constants/a11y';
import { Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarBottom } from '@/hooks/use-tab-bar-inset';

type TabIcon = { ios: SFSymbol; material: AndroidSymbol };

const ICONS = {
  home: { ios: 'house.fill', material: 'home' },
  camera: { ios: 'camera.fill', material: 'photo_camera' },
  my: { ios: 'person.fill', material: 'person' },
} satisfies Record<string, TabIcon>;

const LabelSize = 16;
/**
 * Tab labels follow the system text size up to 1.4×. The bar floats over every screen and each
 * screen reserves a fixed `TabBarHeight` for it, so unlimited growth would cover content.
 */
const LabelMaxScale = 1.4;

export default function AppTabs() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottom = useTabBarBottom();

  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <View
          accessibilityRole="tablist"
          accessibilityLabel="주 메뉴"
          // TabList's slot rejects style arrays.
          style={StyleSheet.flatten([
            styles.bar,
            { bottom, backgroundColor: palette.surface, borderColor: palette.border },
          ])}>
          <TabTrigger name="(home)" href="/" asChild>
            <TabButton label="홈" icon={ICONS.home} palette={palette} />
          </TabTrigger>
          <TabTrigger name="camera" href="/camera" asChild>
            <TabButton label="카메라" icon={ICONS.camera} palette={palette} />
          </TabTrigger>
          <TabTrigger name="mypage" href="/mypage" asChild>
            <TabButton
              label="마이"
              a11yLabel="마이페이지"
              icon={ICONS.my}
              palette={palette}
            />
          </TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = Omit<TabTriggerSlotProps, 'ref'> & {
  label: string;
  a11yLabel?: string;
  icon: TabIcon;
  palette: Palette;
};

function TabButton({ label, a11yLabel, icon, palette, isFocused, ...props }: TabButtonProps) {
  const on = !!isFocused;
  const color = on ? palette.highlightText : palette.textSecondary;

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [
        styles.tab,
        { backgroundColor: on ? palette.highlight : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <SymbolView
        name={{ ios: icon.ios, android: icon.material, web: icon.material }}
        size={24}
        tintColor={color}
      />
      <Text maxFontSizeMultiplier={LabelMaxScale} style={[styles.label, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
  },
  bar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: 6,
    borderRadius: 40,
    borderWidth: 1,
    boxShadow: Shadow.floating,
  },
  tab: {
    minWidth: 84,
    minHeight: 60,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: LabelSize,
    fontWeight: 700,
  },
});
