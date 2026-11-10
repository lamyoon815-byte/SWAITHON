import { createContext, useContext, type ComponentProps } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput } from 'react-native';

import { useSettings } from '@/hooks/use-settings';
import { getFontScale, scaleTextStyle } from '@/lib/font-scale';

const InsideText = createContext(false);

/** 기존 Text API·접근성·ref를 유지하면서 앱의 글씨 크기 설정을 반영한다. */
export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const { settings } = useSettings();
  const nested = useContext(InsideText);
  const scaled = scaleTextStyle(StyleSheet.flatten(style), getFontScale(settings.font_scale), nested);
  return (
    <InsideText value={true}>
      <NativeText {...props} style={[style, scaled]}>{children}</NativeText>
    </InsideText>
  );
}

export function TextInput({ style, ...props }: ComponentProps<typeof NativeTextInput>) {
  const { settings } = useSettings();
  const scaled = scaleTextStyle(StyleSheet.flatten(style), getFontScale(settings.font_scale));
  return <NativeTextInput {...props} style={[style, scaled]} />;
}
