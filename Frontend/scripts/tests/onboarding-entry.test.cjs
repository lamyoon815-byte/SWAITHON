const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (key) => {
    if (!(key in mocks)) throw new Error(`Unexpected import ${key}`);
    return mocks[key];
  }, Object, JSON, Promise });
  return module.exports;
}

test('registration clears completed onboarding before publishing the session; login preserves it', async () => {
  for (const mode of ['register', 'login']) {
    const calls = [];
    const states = ['new@example.com', 'Password123', 'Password123', '새 회원', false, null, {}, false, false];
    let index = 0;
    const component = (name) => ({ [name]: name });
    const ui = (type, props) => ({ type, props });
    const mocks = {
      'react/jsx-runtime': { jsx: ui, jsxs: ui },
      react: { useState: () => [states[index++], () => {}], useRef: (current) => ({ current }) },
      'expo-router': { router: {} }, 'expo-symbols': component('SymbolView'),
      'react-native': { StyleSheet: { create: (value) => value }, Platform: { OS: 'ios' } },
      'react-native-safe-area-context': component('SafeAreaView'),
      '@/components/common/back-button': component('BackButton'),
      '@/components/common/big-button': component('BigButton'),
      '@/components/common/toast': { showToast: (message) => assert.fail(message) },
      '@/constants/a11y': { getPalette: () => ({}) }, '@/constants/theme': { Spacing: {}, ScreenPadding: 20 },
      '@/lib/api': { ApiError: class extends Error {},
        register: async () => { calls.push('register'); return { user: { id: 'new' } }; },
        login: async () => { calls.push('login'); return { user: { id: 'old' } }; } },
      '@/store/settings': { updateSettings: async (patch) => {
        assert.equal(patch.onboarding_completed, false); calls.push('reset onboarding');
      } },
      '@/store/auth': { saveSession: async () => { calls.push('save session'); } },
    };
    const tree = load('components/auth/auth-form.tsx', mocks).AuthForm({ mode });
    function find(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'BigButton' && node.props.label === (mode === 'register' ? '회원가입하고 시작하기' : '로그인')) return node;
      return [node.props?.children].flat(Infinity).map(find).find(Boolean);
    }
    const button = find(tree);
    assert(button);
    await button.props.onPress();
    assert.deepEqual(calls, mode === 'register' ? ['register', 'reset onboarding', 'save session'] : ['login', 'save session']);
  }
});

test('onboarding waits for the home route instead of consuming its one-time check early', () => {
  let pathname = '/auth/register';
  let completed = false;
  const checked = { current: false };
  const routes = [];
  const { FirstLaunch } = load('components/onboarding/first-launch.tsx', {
    react: { useRef: () => checked, useEffect: (fn) => fn() },
    'expo-router': { usePathname: () => pathname, useRootNavigationState: () => ({ key: 'root' }),
      router: { replace: (route) => routes.push(route) } },
    '@/hooks/use-settings': { useSettings: () => ({ loaded: true, settings: { onboarding_completed: completed } }) },
  });
  FirstLaunch();
  assert.equal(checked.current, false);
  pathname = '/';
  FirstLaunch();
  FirstLaunch();
  assert.deepEqual(routes, ['/onboarding']);
  checked.current = false;
  completed = true;
  FirstLaunch();
  assert.deepEqual(routes, ['/onboarding'], 'completed users continue to home');
});

test('explicit incomplete onboarding survives reload even when legacy viewing settings are completed', async () => {
  const stored = new Map([
    ['swaithon:settings:v1', JSON.stringify({ onboarding_completed: true, font_scale: 'large' })],
    ['swaithon.viewing.v1', JSON.stringify({ completed: true })],
  ]);
  const mocks = { '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (key) => stored.get(key) ?? null, setItem: async (key, value) => stored.set(key, value),
  } } };
  const settings = load('store/settings.ts', mocks);
  await settings.updateSettings({ onboarding_completed: false });
  const reloaded = load('store/settings.ts', mocks);
  await reloaded.updateSettings({});
  assert.equal(reloaded.getSettingsSnapshot().settings.onboarding_completed, false);
  assert.equal(reloaded.getSettingsSnapshot().settings.font_scale, 'large');
  stored.set('swaithon:settings:v1', JSON.stringify({ font_scale: 'large' }));
  const legacy = load('store/settings.ts', mocks);
  await legacy.updateSettings({});
  assert.equal(legacy.getSettingsSnapshot().settings.onboarding_completed, true);
});
