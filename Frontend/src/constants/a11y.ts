/**
 * Accessibility tokens for low-vision users.
 * Brand: charcoal + mustard. Light mode fills buttons with charcoal and marks selection with mustard;
 * dark mode fills buttons with mustard. Mustard on white is only 2.1:1, so in light mode it is a fill
 * behind charcoal text, never text or a border by itself.
 * `HighContrast` is a fixed pure black/white/bright-yellow palette that ignores the system light/dark mode.
 */

import { Colors } from '@/constants/theme';

export type Palette = {
  background: string;
  surface: string;
  /** Secondary fill: voice/back buttons, number tiles, image placeholders, pressed rows. */
  fill: string;
  text: string;
  textSecondary: string;
  /** Primary button fill. */
  accent: string;
  accentText: string;
  /** Selected tab, chosen option, "recent" badge. Pair with a non-color cue (bold, ✓, bar). */
  highlight: string;
  highlightText: string;
  border: string;
  /** Card and section outline: 3:1 against the page so low-vision users can see where a card ends. */
  outline: string;
  danger: string;
};

export const Mustard = '#E1AD21';
export const Charcoal = '#33353B';
/** High-contrast mode only. Brighter than mustard so it stands out on pure black. */
export const Yellow = '#FFD60A';

export const HighContrast: Palette = {
  background: '#000000',
  surface: '#000000',
  fill: '#333333',
  text: '#FFFFFF',
  textSecondary: '#FFFFFF',
  accent: Yellow,
  accentText: '#000000',
  highlight: Yellow,
  highlightText: '#000000',
  border: '#FFFFFF',
  outline: '#FFFFFF',
  danger: Yellow,
};

export function getPalette(scheme: 'light' | 'dark', highContrast: boolean): Palette {
  if (highContrast) return HighContrast;
  const c = Colors[scheme];
  const dark = scheme === 'dark';
  return {
    background: c.background,
    surface: c.backgroundElement,
    fill: c.backgroundSelected,
    text: c.text,
    textSecondary: c.textSecondary,
    accent: dark ? Mustard : Charcoal, // button text contrast: dark 8.2:1, light 12.3:1
    accentText: dark ? c.background : '#FFFFFF',
    highlight: Mustard, // charcoal text on it: light 7.2:1, dark 8.2:1
    highlightText: dark ? c.background : c.text,
    border: dark ? '#8A8F99' : Charcoal,
    outline: dark ? '#70747F' : '#868A94', // vs page: dark 3.6:1, light 3.3:1
    // No red in the app: errors use the point mustard with an icon. Mustard text on white is only
    // 2.1:1, so light mode falls back to charcoal and the icon carries the alert.
    danger: dark ? Mustard : Charcoal,
  };
}

/** Minimum touch target (pt). Apple HIG 44, Material 48 — we go larger for low vision. */
export const MinTouchTarget = 56;

/**
 * Text buttons (the reference pair "판매하기 / 구매하기", measured on a 402pt-wide screen):
 * 56 tall, 16 corner radius, 8 between side-by-side buttons. Icon-only buttons stay round.
 * Heights are minimums in styles, so the label can still grow with the system text size.
 */
export const ButtonHeight = MinTouchTarget;
export const ButtonRadius = 16;
export const ButtonGap = 8;

export const FontSize = {
  body: 20,
  label: 18,
  heading: 26,
  button: 22,
} as const;
