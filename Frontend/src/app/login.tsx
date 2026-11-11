/**
 * 로그인 · 회원가입 (BE `/auth/login`, `/auth/register`). 마이페이지의 "로그인하기"에서 들어온다.
 * 위 탭으로 로그인/회원가입을 바꾸고, 버튼은 아래에 고정한다. 성공하면 들어온 화면으로 돌아간다.
 * 서버 주소(EXPO_PUBLIC_API_URL)가 없으면 기기 안 mock 계정으로 흐름만 확인한다.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
import { Text, TextInput } from '@/components/common/text';
import { showToast } from '@/components/common/toast';
import { ButtonRadius, FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { AuthError } from '@/lib/api';

type Mode = 'login' | 'register';
type InputRef = ComponentRef<typeof RNTextInput>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const palette = getPalette('dark', false);
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);
  const registering = mode === 'register';

  const problem = registering && !nickname.trim() ? '닉네임을 입력해 주세요.'
    : !EMAIL.test(email.trim()) ? '이메일을 정확히 입력해 주세요.'
      : password.length < 8 ? '비밀번호는 8자 이상이에요.' : null;

  const switchMode = (next: Mode) => {
    if (busy || next === mode) return;
    setMode(next);
    setError(null);
  };
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/mypage');
  };
  const submit = async () => {
    if (busy) return;
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      if (registering) await signUp(email, password, nickname);
      else await signIn(email, password);
      showToast(registering ? '가입을 마쳤어요. 환영해요!' : '로그인했어요', 'success');
      leave();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : '로그인하지 못했어요. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <BackButton label="마이페이지로" palette={palette} onPress={leave} />
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{registering ? '회원가입' : '로그인'}</Text>
          <View style={styles.headerSpace} />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: barHeight + 40 }]}>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.lead, { color: palette.text }]}>
            {registering ? '계정을 만들면\n내 보기 설정과 관람 기록을\n이어서 쓸 수 있어요' : '다시 오신 걸 환영해요'}
          </Text>

          <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: palette.surface, borderColor: palette.outline }]}>
            {(['login', 'register'] as const).map((key) => {
              const active = mode === key;
              return (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => switchMode(key)}
                  style={({ pressed }) => [styles.segment, { backgroundColor: active ? palette.highlight : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={[styles.segmentText, { color: active ? palette.highlightText : palette.textSecondary }]}>{key === 'login' ? '로그인' : '회원가입'}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.fields}>
            {registering && (
              <Field label="닉네임" palette={palette}>
                <TextInput value={nickname} onChangeText={setNickname} placeholder="앱에서 부를 이름" placeholderTextColor={palette.textSecondary}
                  maxLength={40} autoComplete="nickname" textContentType="nickname" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()}
                  accessibilityLabel="닉네임" style={[styles.input, inputColors(palette)]} />
              </Field>
            )}
            <Field label="이메일" palette={palette}>
              <TextInput ref={emailRef} value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={palette.textSecondary}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} accessibilityLabel="이메일" style={[styles.input, inputColors(palette)]} />
            </Field>
            <Field label="비밀번호" palette={palette} hint={registering ? '8자 이상' : undefined}>
              <View>
                <TextInput ref={passwordRef} value={password} onChangeText={setPassword} placeholder="비밀번호" placeholderTextColor={palette.textSecondary}
                  secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}
                  autoComplete={registering ? 'new-password' : 'current-password'} textContentType={registering ? 'newPassword' : 'password'}
                  returnKeyType="done" onSubmitEditing={() => { void submit(); }} accessibilityLabel="비밀번호"
                  style={[styles.input, styles.passwordInput, inputColors(palette)]} />
                <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onPress={() => setShowPassword((v) => !v)} style={styles.eye}>
                  <SymbolView name={showPassword ? { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' } : { ios: 'eye', android: 'visibility', web: 'visibility' }}
                    size={22} tintColor={palette.textSecondary} />
                </Pressable>
              </View>
            </Field>
          </View>

          {error && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: palette.danger }]}>{error}</Text>
          )}
        </ScrollView>

        <BottomActionBar background={palette.background} onHeight={setBarHeight}>
          <View style={styles.buttonRow}>
            <BigButton label={busy ? (registering ? '가입하는 중…' : '로그인하는 중…') : registering ? '가입하기' : '로그인'} palette={palette} disabled={busy} onPress={() => { void submit(); }} />
          </View>
        </BottomActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function inputColors(palette: Palette) {
  return { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border };
}

function Field({ label, hint, palette, children }: { label: string; hint?: string; palette: Palette; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
        {hint && <Text style={[styles.fieldHint, { color: palette.textSecondary }]}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two },
  title: { flex: 1, fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center' },
  headerSpace: { width: MinTouchTarget },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, gap: Spacing.four },
  lead: { fontSize: FontSize.heading, lineHeight: 36, fontWeight: 700 },
  segmented: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: FontSize.label, fontWeight: 700 },
  fields: { gap: Spacing.three },
  field: { gap: Spacing.two },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  fieldLabel: { fontSize: FontSize.label, fontWeight: 700 },
  fieldHint: { fontSize: 16, fontWeight: 600 },
  input: { minHeight: MinTouchTarget, borderWidth: 1.5, borderRadius: ButtonRadius, paddingHorizontal: Spacing.three, fontSize: FontSize.body },
  passwordInput: { paddingRight: MinTouchTarget + Spacing.two },
  eye: { position: 'absolute', right: 0, top: 0, bottom: 0, width: MinTouchTarget, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: FontSize.label, lineHeight: 27, fontWeight: 600 },
  buttonRow: { flexDirection: 'row' },
});
