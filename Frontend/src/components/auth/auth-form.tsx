import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { ApiError, login, register } from '@/lib/api';
import { saveSession } from '@/store/auth';
import { updateSettings } from '@/store/settings';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** New passwords: 8~128 characters with at least one English letter and one digit (same rule as the server). */
export const isStrongPassword = (value: string) =>
  value.length >= 8 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value);

type Field = 'nickname' | 'email' | 'password' | 'confirm';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const signup = mode === 'register';
  const palette = getPalette('dark', false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState<Field | null>(null);
  // A rule is shown only after the person leaves the field or presses the button, then updates live.
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const submit = async () => {
    if (lock.current) return;
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    lock.current = true; setBusy(true);
    try {
      const result = signup ? await register(email, password, nickname) : await login(email, password);
      // 같은 기기에서 이전 계정이 소개를 완료했어도 새 회원은 소개부터 시작한다.
      if (signup) await updateSettings({ onboarding_completed: false });
      await saveSession(result);
      // 보호 경로가 홈으로 전환된 뒤 FirstLaunch가 소개로 연결한다.
    } catch (err) {
      showToast(err instanceof ApiError
        ? err.status === 401 ? '이메일 또는 비밀번호가 맞지 않아요.'
          : err.status === 409 ? '이미 가입된 이메일이에요. 로그인해 주세요.'
            : err.status === 429 ? '시도가 너무 많아요. 잠시 후 다시 해 주세요.'
              : err.status === 422 ? '입력한 이메일, 비밀번호와 이름을 확인해 주세요.' : err.message
        : '연결하거나 로그인 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
    } finally { lock.current = false; setBusy(false); }
  };

  const problems: Record<Field, string> = {
    nickname: signup && !nickname.trim() ? '사용할 이름을 입력해 주세요.' : '',
    email: !email.trim() ? '이메일을 입력해 주세요.' : !EMAIL.test(email.trim()) ? '이메일 형식이 올바르지 않아요.' : '',
    password: !password ? '비밀번호를 입력해 주세요.'
      : signup ? (isStrongPassword(password) ? '' : '영문과 숫자를 포함해 8자 이상 입력해 주세요.')
        : password.length < 8 || password.length > 128 ? '비밀번호는 8자 이상이에요.' : '',
    confirm: signup && confirm !== password ? '비밀번호가 일치하지 않아요.' : '',
  };
  const shown = (name: Field) => (tried || touched[name]) && (name !== 'confirm' || tried || !!confirm) ? problems[name] : '';
  const leave = (name: Field) => { setFocused(null); setTouched((t) => ({ ...t, [name]: true })); };
  const fieldStyle = (name: Field) => [styles.field, {
    backgroundColor: palette.surface,
    borderColor: shown(name) ? palette.danger : focused === name ? palette.accent : palette.outline,
  }];
  const hint = (name: Field) => !!shown(name) && (
    <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: palette.danger }]}>{shown(name)}</Text>
  );
  const inputStyle = [styles.input, { color: palette.text }];
  const passwordToggle = (
    <Pressable accessibilityRole="button" accessibilityLabel={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
      accessibilityState={{ selected: visible }} hitSlop={4}
      onPress={() => setVisible((v) => !v)} style={styles.eyeButton}>
      <SymbolView name={{ ios: visible ? 'eye.slash.fill' : 'eye.fill', android: visible ? 'visibility_off' : 'visibility', web: visible ? 'visibility_off' : 'visibility' }}
        size={22} tintColor={palette.textSecondary} />
    </Pressable>
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
          <View style={[styles.content, signup && styles.signupContent]}>
            <View style={[styles.navigation, signup && styles.signupNavigation]}>
              <BackButton label="시작 화면으로" palette={palette} onPress={() => router.canGoBack() ? router.back() : router.replace('/auth')} />
            </View>
            <View style={styles.heading}>
              <Text style={[styles.brand, { color: palette.highlight }]}>MoMi</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
                {signup ? '회원가입' : '로그인'}
              </Text>
              <Text style={[styles.copy, { color: palette.textSecondary }]}>
                {signup ? '편하게 볼 수 있는 나만의 미술관을 시작해요.' : '내게 편한 보기 설정으로 감상을 이어가요.'}
              </Text>
            </View>

            {/* Slim fields with only a placeholder; a red line under a field explains a rule it breaks. */}
            <View style={styles.fields}>
              {signup && <View style={styles.group}>
                <View style={fieldStyle('nickname')}>
                  <TextInput accessibilityLabel="이름" placeholder="이름을 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={nickname} onChangeText={setNickname} editable={!busy} maxLength={40} autoComplete="nickname"
                    onFocus={() => setFocused('nickname')} onBlur={() => leave('nickname')} style={inputStyle} />
                </View>
                {hint('nickname')}
              </View>}
              <View style={styles.group}>
                <View style={fieldStyle('email')}>
                  <TextInput accessibilityLabel="이메일" placeholder="이메일을 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={email} onChangeText={setEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none"
                    autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    onFocus={() => setFocused('email')} onBlur={() => leave('email')} style={inputStyle} />
                </View>
                {hint('email')}
              </View>
              <View style={styles.group}>
                <View style={[fieldStyle('password'), styles.inputRow]}>
                  <TextInput accessibilityLabel="비밀번호" placeholder="비밀번호를 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={password} onChangeText={setPassword} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete={signup ? 'new-password' : 'current-password'}
                    textContentType={signup ? 'newPassword' : 'password'} style={inputStyle}
                    onFocus={() => setFocused('password')} onBlur={() => leave('password')}
                    returnKeyType={signup ? 'next' : 'go'} onSubmitEditing={signup ? undefined : submit} />
                  {passwordToggle}
                </View>
                {hint('password')}
              </View>
              {signup && <View style={styles.group}>
                <View style={fieldStyle('confirm')}>
                  <TextInput accessibilityLabel="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={confirm} onChangeText={setConfirm} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                    onFocus={() => setFocused('confirm')} onBlur={() => leave('confirm')}
                    returnKeyType="go" onSubmitEditing={submit} style={inputStyle} />
                </View>
                {hint('confirm')}
              </View>}
            </View>

            <View style={styles.actions}>
              <View style={styles.row}>
                <BigButton label={busy ? '잠시만 기다려 주세요…' : signup ? '회원가입하고 시작하기' : '로그인'} palette={palette} disabled={busy} onPress={submit} />
              </View>
              {!signup && <>
              <View style={styles.or} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.orLine, { backgroundColor: palette.outline }]} />
                <Text style={[styles.orText, { color: palette.textSecondary }]}>또는</Text>
                <View style={[styles.orLine, { backgroundColor: palette.outline }]} />
              </View>
              <View style={styles.row}>
                <BigButton label="회원가입" palette={palette} selected={false} disabled={busy}
                  onPress={() => router.push('/auth/register')} />
              </View>
              </>}
            </View>
            <Text style={[styles.credit, { color: palette.textSecondary }]}>SWAITHON · 김규린 · 김민서 · 박지현 · 배정윤</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const FieldRadius = 12;

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flexGrow: 1, paddingBottom: Spacing.four },
  navigation: { alignItems: 'flex-start' },
  signupNavigation: { marginTop: ScreenPadding, marginBottom: -ScreenPadding },
  content: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: ScreenPadding, gap: Spacing.four },
  signupContent: { paddingTop: 0 },
  heading: { alignItems: 'center', gap: 12, paddingVertical: Spacing.two },
  brand: { fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 30, lineHeight: 40, fontWeight: '800', textAlign: 'center', letterSpacing: -1 },
  copy: { fontSize: 18, lineHeight: 28, textAlign: 'center' },
  fields: { gap: 12 }, group: { gap: 6 },
  field: { paddingHorizontal: 16, borderWidth: 1.5, borderRadius: FieldRadius },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 4, paddingHorizontal: 0, fontSize: 17 },
  eyeButton: { width: 44, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 15, lineHeight: 21, fontWeight: '600', paddingHorizontal: 4 },
  actions: { gap: 12 }, row: { flexDirection: 'row' },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: 15 },
  credit: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
