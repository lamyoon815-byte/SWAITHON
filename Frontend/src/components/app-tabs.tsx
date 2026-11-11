/**
 * Bottom tab bar: 홈 · 카메라 · 마이 (design "저시력 미술관 앱").
 * A pill floating above the content; the selected tab gets a filled mustard pill behind it,
 * so selection is shown by shape and contrast, not by color alone. (The design's gray pill is
 * near-invisible on the light bar, about 1.2:1, so both modes use the highlight color.)
 * Like Toss, there is one highlight pill that slides to the tab you tap, and the new tab's icon
 * gives a small bounce. With "Reduce motion" on, the pill jumps and nothing bounces.
 * The bar is slightly see-through with a blur behind it (88% opaque, so the gray labels keep 4.5:1
 * even over the opposite color). With "Reduce transparency" on, it is fully opaque.
 * Screens pad their bottom with `useTabBarInset()` so nothing hides behind it.
 */

import { BlurView } from 'expo-blur';
import { usePathname } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/components/common/text';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

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

const LabelSize = 18;
/**
 * Tab labels follow the system text size up to 1.4×. The bar floats over every screen and each
 * screen reserves a fixed `TabBarHeight` for it, so unlimited growth would cover content.
 */
const LabelMaxScale = 1.4;
const BarPadding = 6;
/** How opaque the see-through bar is. Lower than this and gray labels can drop under 4.5:1. */
const BarOpacity = 0.88;
/** Quick and settled, no wobble: the pill should arrive, not bounce around. */
const Slide = { damping: 22, stiffness: 260, mass: 0.9 };

/** Where the highlight pill should sit: the selected tab's x and width inside the bar. */
type Indicator = { x: SharedValue<number>; width: SharedValue<number>; ready: SharedValue<number> };

/** "#RRGGBB" → "rgba(r,g,b,a)". */
function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The iOS / Android "Reduce transparency" setting, kept up to date while the app runs. */
function useReduceTransparency() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // React Native Web does not provide the native transparency preference API.
    if (typeof AccessibilityInfo.isReduceTransparencyEnabled !== 'function') return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setOn, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

export default function AppTabs() {
  const hideBar = /^\/artwork\/[^/]+\/narration\/?$/.test(usePathname());
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = getPalette(scheme, false);
  const bottom = useTabBarBottom();
  const solid = useReduceTransparency();
  const indicator: Indicator = {
    x: useSharedValue(0),
    width: useSharedValue(0),
    ready: useSharedValue(0),
  };

  const pillStyle = useAnimatedStyle(() => ({
    opacity: indicator.ready.get(),
    width: indicator.width.get(),
    transform: [{ translateX: indicator.x.get() }],
  }));

  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <View
          accessibilityRole="tablist"
          accessibilityLabel="주 메뉴"
          accessibilityElementsHidden={hideBar}
          importantForAccessibility={hideBar ? 'no-hide-descendants' : 'auto'}
          pointerEvents={hideBar ? 'none' : 'auto'}
          // TabList's slot rejects style arrays.
          style={StyleSheet.flatten([
            styles.bar,
            {
              bottom,
              display: hideBar ? 'none' : 'flex',
              backgroundColor: solid ? palette.surface : withAlpha(palette.surface, BarOpacity),
              borderColor: palette.border,
            },
          ])}>
          {!solid && (
            <BlurView
              pointerEvents="none"
              intensity={40}
              tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
              style={StyleSheet.absoluteFill}
            />
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { backgroundColor: palette.highlight }, pillStyle]}
          />
          <TabTrigger name="(home)" href="/" asChild>
            <TabButton label="홈" icon={ICONS.home} palette={palette} indicator={indicator} />
          </TabTrigger>
          <TabTrigger name="camera" href="/camera" asChild>
            <TabButton label="카메라" icon={ICONS.camera} palette={palette} indicator={indicator} />
          </TabTrigger>
          <TabTrigger name="mypage" href="/mypage" asChild>
            <TabButton
              label="마이"
              a11yLabel="마이페이지"
              icon={ICONS.my}
              palette={palette}
              indicator={indicator}
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
  indicator: Indicator;
};

function TabButton({
  label,
  a11yLabel,
  icon,
  palette,
  indicator,
  isFocused,
  ...props
}: TabButtonProps) {
  const on = !!isFocused;
  const color = on ? palette.highlightText : palette.textSecondary;
  const reduceMotion = useReducedMotion();
  const layout = useRef<{ x: number; width: number } | null>(null);
  const iconScale = useSharedValue(1);

  /** Send the pill to this tab: slide when it is already showing, place it on the first layout. */
  const movePill = (animate: boolean) => {
    if (!layout.current) return;
    const { x, width } = layout.current;
    const slide = animate && !reduceMotion && indicator.ready.get() === 1;
    indicator.x.set(slide ? withSpring(x, Slide) : x);
    indicator.width.set(slide ? withSpring(width, Slide) : width);
    indicator.ready.set(1);
  };

  useEffect(() => {
    if (!on) return;
    movePill(true);
    if (!reduceMotion) {
      iconScale.set(
        withSequence(withTiming(1.15, { duration: 120 }), withSpring(1, { damping: 12 })),
      );
    }
    // Only a change of selection should move the pill; layout changes go through onLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  const onLayout = (e: LayoutChangeEvent) => {
    layout.current = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
    if (on) movePill(false);
  };

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.get() }] }));

  return (
    <Pressable
      {...props}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Animated.View style={iconStyle}>
        <SymbolView
          name={{ ios: icon.ios, android: icon.material, web: icon.material }}
          size={24}
          tintColor={color}
        />
      </Animated.View>
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
    padding: BarPadding,
    borderRadius: 40,
    borderWidth: 1,
    // Clips the blur to the rounded bar; the shadow is drawn outside and is not clipped.
    overflow: 'hidden',
    boxShadow: Shadow.floating,
  },
  // One pill behind the tabs; it slides to the selected one (see TabButton).
  pill: {
    position: 'absolute',
    left: 0,
    top: BarPadding,
    bottom: BarPadding,
    borderRadius: 30,
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
