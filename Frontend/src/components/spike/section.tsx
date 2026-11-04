import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, type Palette } from '@/constants/a11y';

type Props = { title: string; palette: Palette; children: ReactNode };

export function Section({ title, palette, children }: Props) {
  return (
    <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function InfoText({ palette, children }: { palette: Palette; children: ReactNode }) {
  return <Text style={[styles.info, { color: palette.text }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 800,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  info: {
    fontSize: FontSize.label,
    lineHeight: FontSize.label * 1.4,
  },
});
