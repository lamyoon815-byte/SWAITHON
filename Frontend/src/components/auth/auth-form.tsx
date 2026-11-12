import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { BottomActionBar } from '@/components/common/bottom-action-bar';
// The app's Text/TextInput follow the font-size setting in 마이페이지; react-native's do not.
import { Text, TextInput } from '@/components/common/text';
import { TextButton } from '@/components/common/text-button';
import { showToast } from '@/components/common/toast';
import { FontSize, MinTouchTarget, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { ApiError, login, register } from '@/lib/api';
import { saveSession } from '@/store/auth';

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
  const [barHeight, setBarHeight] = useState(0);
  const lock = useRef(false);

  const submit = async () => {
    if (lock.current) return;
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    lock.current = true; setBusy(true);
    try {
      const result = signup ? await register(email, password, nickname) : await login(email, password);
      await saveSession(result);
      // Root protected routes select calibration or the home screen after the session changes.
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
    // Rules are guidance, not alarms: the border only marks the focused field, never turns red.
    borderColor: focused === name ? palette.accent : palette.outline,
  }];
  // Guidance in the point mustard (8.2:1 on the dark background), with an icon so it is not color alone.
  const hint = (name: Field) => !!shown(name) && (
    <View style={styles.hintRow}>
      <SymbolView name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }} size={20} tintColor={palette.highlight} />
      <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: palette.highlight }]}>{shown(name)}</Text>
    </View>
  );
  const submitButton = (
    <View style={styles.row}>
      <BigButton label={busy ? '잠시만 기다려 주세요…' : signup ? '회원가입하고 시작하기' : '로그인'} palette={palette} disabled={busy} onPress={submit} />
    </View>
  );
  // A visible name above each field: a placeholder vanishes once typing starts and is low contrast.
  const label = (text: string) => (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.label, { color: palette.text }]}>{text}</Text>
  );
  const inputStyle = [styles.input, { color: palette.text }];
  const passwordToggle = (
    <Pressable accessibilityRole="button" accessibilityLabel={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
      accessibilityState={{ selected: visible }} hitSlop={4}
      onPress={() => setVisible((v) => !v)} style={styles.eyeButton}>
      <SymbolView name={{ ios: visible ? 'eye.slash.fill' : 'eye.fill', android: visible ? 'visibility_off' : 'visibility', web: visible ? 'visibility_off' : 'visibility' }}
        size={26} tintColor={palette.textSecondary} />
    </Pressable>
  );
  return (
    // On sign-up the start button is pinned to the bottom bar, which pads the bottom safe area itself.
    <SafeAreaView edges={signup ? ['top', 'left', 'right'] : undefined} style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.scroll, signup && { paddingBottom: barHeight + Spacing.four }]}>
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

            {/* A name above each field; a guidance line under a field explains a rule it breaks.
                The password and its confirmation share one name so they read as one pair. */}
            <View style={styles.fields}>
              {signup && <View style={styles.group}>
                {label('이름')}
                <View style={fieldStyle('nickname')}>
                  <TextInput accessibilityLabel="이름" placeholder="이름을 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={nickname} onChangeText={setNickname} editable={!busy} maxLength={40} autoComplete="nickname"
                    onFocus={() => setFocused('nickname')} onBlur={() => leave('nickname')} style={inputStyle} />
                </View>
                {hint('nickname')}
              </View>}
              <View style={styles.group}>
                {label('이메일')}
                <View style={fieldStyle('email')}>
                  <TextInput accessibilityLabel="이메일" placeholder="이메일을 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={email} onChangeText={setEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none"
                    autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    onFocus={() => setFocused('email')} onBlur={() => leave('email')} style={inputStyle} />
                </View>
                {hint('email')}
              </View>
              <View style={styles.group}>
                {label('비밀번호')}
                <View style={[fieldStyle('password'), styles.inputRow]}>
                  <TextInput accessibilityLabel="비밀번호" placeholder={signup ? '영문·숫자 포함 8자 이상' : '비밀번호를 입력해 주세요'} placeholderTextColor={palette.textSecondary}
                    value={password} onChangeText={setPassword} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete={signup ? 'new-password' : 'current-password'}
                    textContentType={signup ? 'newPassword' : 'password'} style={inputStyle}
                    onFocus={() => setFocused('password')} onBlur={() => leave('password')}
                    returnKeyType={signup ? 'next' : 'go'} onSubmitEditing={signup ? undefined : submit} />
                  {passwordToggle}
                </View>
                {hint('password')}
                {signup && <View style={fieldStyle('confirm')}>
                  <TextInput accessibilityLabel="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={confirm} onChangeText={setConfirm} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                    onFocus={() => setFocused('confirm')} onBlur={() => leave('confirm')}
                    returnKeyType="go" onSubmitEditing={submit} style={inputStyle} />
                </View>}
                {signup && hint('confirm')}
              </View>
            </View>

            {!signup && <View style={styles.actions}>
              {submitButton}
              <View style={styles.or} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.orLine, { backgroundColor: palette.outline }]} />
                <Text style={[styles.orText, { color: palette.textSecondary }]}>또는</Text>
                <View style={[styles.orLine, { backgroundColor: palette.outline }]} />
              </View>
              <TextButton label="회원가입하기" palette={palette} disabled={busy}
                onPress={() => router.push('/auth/register')} />
            </View>}
            <Text style={[styles.credit, { color: palette.textSecondary }]}>SWAITHON · 김규린 · 김민서 · 박지현 · 배정윤</Text>
          </View>
        </ScrollView>
        {signup && <BottomActionBar background={palette.background} onHeight={setBarHeight}>{submitButton}</BottomActionBar>}
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
  brand: { fontSize: FontSize.label, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 30, lineHeight: 40, fontWeight: '800', textAlign: 'center', letterSpacing: -1 },
  copy: { fontSize: FontSize.label, lineHeight: 28, textAlign: 'center' },
  fields: { gap: 20 }, group: { gap: 8 },
  label: { fontSize: FontSize.label, lineHeight: 26, fontWeight: '700', paddingHorizontal: 4 },
  field: { paddingHorizontal: 16, borderWidth: 1.5, borderRadius: FieldRadius },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  input: { flex: 1, minWidth: 0, minHeight: 60, paddingVertical: 8, paddingHorizontal: 0, fontSize: FontSize.body },
  eyeButton: { width: MinTouchTarget, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  hint: { flex: 1, fontSize: FontSize.label, lineHeight: 26, fontWeight: '600' },
  actions: { gap: 12 }, row: { flexDirection: 'row' },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: FontSize.label },
  credit: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
