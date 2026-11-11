import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { Text } from '@/components/common/text';
import { getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';

/** The first screen after the splash: introduce MoMi before asking for credentials. */
export default function WelcomeScreen() {
  const palette = getPalette('dark', false);
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={[styles.logo, { color: palette.highlight }]}>MoMi</Text>
            <Text style={[styles.tagline, { color: palette.text }]}>{'모두가 같은 작품을,\n각자의 방식으로'}</Text>
            <Image
              source={require('@/assets/images/mascot/chameleon.png')}
              contentFit="contain"
              style={styles.character}
              accessibilityLabel="헤드폰을 쓴 MoMi 카멜레온"
            />
          </View>
          <View style={styles.actions}>
            <View style={styles.row}>
              <BigButton label="로그인" palette={palette} onPress={() => router.push('/auth/login')} />
            </View>
            <View style={styles.row}>
              <BigButton label="회원가입" palette={palette} selected={false} onPress={() => router.push('/auth/register')} />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.four },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', gap: Spacing.five },
  hero: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.four },
  logo: { fontSize: 44, lineHeight: 56, fontWeight: '800', letterSpacing: 1.5 },
  tagline: { fontSize: 28, lineHeight: 40, fontWeight: '700', textAlign: 'center', letterSpacing: -0.6 },
  character: { width: '100%', maxWidth: 300, height: 280 },
  actions: { gap: 12 },
  row: { flexDirection: 'row' },
});
