import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { BigButton } from '@/components/common/big-button';
import { FontSize, getPalette } from '@/constants/a11y';
import { ScreenPadding, Spacing } from '@/constants/theme';
import { ApiError, login, register } from '@/lib/api';
import { saveSession } from '@/store/auth';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const signup = mode === 'register';
  const palette = getPalette('dark', false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const submit = async () => {
    if (lock.current) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('이메일 주소를 확인해 주세요.');
    if (password.length < 8 || password.length > 128) return setError('비밀번호는 8~128자로 입력해 주세요.');
    if (signup && !nickname.trim()) return setError('사용할 이름을 입력해 주세요.');
    if (signup && password !== confirm) return setError('두 비밀번호가 같지 않아요. 다시 확인해 주세요.');
    lock.current = true; setBusy(true); setError('');
    try {
      const result = signup ? await register(email, password, nickname) : await login(email, password);
      await saveSession(result);
      // Root protected routes select calibration or the home screen after the session changes.
    } catch (err) {
      setError(err instanceof ApiError
        ? err.status === 401 ? '이메일 또는 비밀번호가 맞지 않아요.'
          : err.status === 409 ? '이미 가입된 이메일이에요. 로그인해 주세요.'
            : err.status === 429 ? '시도가 너무 많아요. 잠시 후 다시 해 주세요.'
              : err.status === 422 ? '입력한 이메일, 비밀번호와 이름을 확인해 주세요.' : err.message
        : '연결하거나 로그인 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally { lock.current = false; setBusy(false); }
  };

  const fieldStyle = (name: string) => [styles.field, {
    backgroundColor: palette.surface,
    borderColor: focused === name ? palette.accent : palette.outline,
  }];
  const inputStyle = [styles.input, { color: palette.text }];
  const passwordToggle = (
    <Pressable accessibilityRole="button" accessibilityLabel={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
      accessibilityState={{ selected: visible }} hitSlop={4}
      onPress={() => setVisible((v) => !v)} style={styles.eyeButton}>
      <SymbolView name={{ ios: visible ? 'eye.slash.fill' : 'eye.fill', android: visible ? 'visibility_off' : 'visibility', web: visible ? 'visibility_off' : 'visibility' }}
        size={25} tintColor={palette.textSecondary} />
    </Pressable>
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            <View style={styles.navigation}>
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

            <View style={styles.fields}>
              {signup && <View style={styles.group}>
                <Text style={[styles.label, { color: palette.text }]}>이름</Text>
                <View style={fieldStyle('nickname')}>
                  <TextInput accessibilityLabel="이름" placeholder="앱에서 사용할 이름" placeholderTextColor={palette.textSecondary}
                    value={nickname} onChangeText={setNickname} editable={!busy} maxLength={40} autoComplete="nickname"
                    onFocus={() => setFocused('nickname')} onBlur={() => setFocused(null)} style={inputStyle} />
                </View>
              </View>}
              <View style={styles.group}>
                <Text style={[styles.label, { color: palette.text }]}>이메일</Text>
                <View style={[fieldStyle('email'), styles.inputRow]}>
                  <TextInput accessibilityLabel="이메일" placeholder="name@example.com" placeholderTextColor={palette.textSecondary}
                    value={email} onChangeText={setEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none"
                    autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} style={inputStyle} />
                  <View style={styles.fieldIcon} pointerEvents="none" accessibilityElementsHidden>
                    <SymbolView name={{ ios: 'envelope.fill', android: 'mail', web: 'mail' }} size={24} tintColor={palette.textSecondary} />
                  </View>
                </View>
              </View>
              <View style={styles.group}>
                <Text style={[styles.label, { color: palette.text }]}>비밀번호</Text>
                <View style={[fieldStyle('password'), styles.inputRow]}>
                  <TextInput accessibilityLabel="비밀번호" placeholder="8자 이상 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={password} onChangeText={setPassword} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete={signup ? 'new-password' : 'current-password'}
                    textContentType={signup ? 'newPassword' : 'password'} style={inputStyle}
                    onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
                    returnKeyType={signup ? 'next' : 'go'} onSubmitEditing={signup ? undefined : submit} />
                  {passwordToggle}
                </View>
              </View>
              {signup && <View style={styles.group}>
                <Text style={[styles.label, { color: palette.text }]}>비밀번호 확인</Text>
                <View style={fieldStyle('confirm')}>
                  <TextInput accessibilityLabel="비밀번호 확인" placeholder="한 번 더 입력해 주세요" placeholderTextColor={palette.textSecondary}
                    value={confirm} onChangeText={setConfirm} editable={!busy} secureTextEntry={!visible} maxLength={128}
                    autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                    onFocus={() => setFocused('confirm')} onBlur={() => setFocused(null)}
                    returnKeyType="go" onSubmitEditing={submit} style={inputStyle} />
                </View>
              </View>}
            </View>

            {!!error && <View accessibilityRole="alert" accessibilityLiveRegion="assertive"
              style={[styles.error, { borderColor: palette.danger, backgroundColor: palette.surface }]}>
              <SymbolView name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }} size={24} tintColor={palette.danger} />
              <Text style={[styles.errorText, { color: palette.text }]}>{error}</Text>
            </View>}
            <View style={styles.actions}>
              <View style={styles.row}>
                <BigButton label={busy ? '잠시만 기다려 주세요…' : signup ? '회원가입하고 시작하기' : '로그인'} palette={palette} disabled={busy} onPress={submit} />
              </View>
              <Text style={[styles.footerLabel, { color: palette.textSecondary }]}>{signup ? '이미 계정이 있으신가요?' : '처음 오셨나요?'}</Text>
              <View style={styles.row}>
                <BigButton label={signup ? '로그인으로 돌아가기' : '회원가입'} palette={palette} selected={false} disabled={busy}
                  onPress={() => signup ? router.replace('/auth/login') : router.push('/auth/register')} />
              </View>
            </View>
            <Text style={[styles.credit, { color: palette.textSecondary }]}>SWAITHON · 김규린 · 김민서 · 박지현 · 배정윤</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const FieldRadius = 16;

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flexGrow: 1, paddingBottom: Spacing.four },
  navigation: { alignItems: 'flex-start' },
  content: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: ScreenPadding, gap: Spacing.four },
  heading: { alignItems: 'center', gap: 12, paddingVertical: Spacing.two },
  brand: { fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 30, lineHeight: 40, fontWeight: '800', textAlign: 'center', letterSpacing: -1 },
  copy: { fontSize: 18, lineHeight: 28, textAlign: 'center' },
  fields: { gap: Spacing.three }, group: { gap: Spacing.two },
  // 라벨은 박스의 둥근 모서리가 끝나는 곳(=radius)에서 시작한다. 입력 글자도 border 2 + padding 14 = 16에서 시작해 같은 선에 맞는다.
  field: { paddingHorizontal: FieldRadius - 2, borderWidth: 2, borderRadius: FieldRadius },
  label: { fontSize: 17, fontWeight: '700', paddingLeft: FieldRadius }, inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 56, paddingVertical: 8, paddingHorizontal: 0, fontSize: 18 },
  eyeButton: { width: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  fieldIcon: { width: 40, alignItems: 'center' },
  actions: { gap: 12 }, row: { flexDirection: 'row' },
  footerLabel: { fontSize: 17, textAlign: 'center', paddingTop: 6 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, borderWidth: 2 },
  errorText: { flex: 1, fontSize: FontSize.body, lineHeight: 28 },
  credit: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
