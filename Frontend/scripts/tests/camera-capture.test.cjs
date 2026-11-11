const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

test('capture waits for camera warmup and prevents duplicate shutters while the photo is pending', async () => {
  const slots = [], timers = new Map(), captures = [];
  let cursor = 0, timerId = 0, finishPhoto;
  const mocks = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    react: {
      useState: (initial) => { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (next) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
      useRef: (initial) => { const slot = cursor++; slots[slot] ??= { current: initial }; return slots[slot]; },
      useEffect: () => {},
    },
    'expo-image': { Image: 'Image' },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, () => {}] },
    'expo-router': { router: {} },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { View: 'View', StyleSheet: { create: (v) => v, absoluteFill: {} }, AccessibilityInfo: {}, Linking: {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/constants/a11y': { getPalette: () => ({}), FontSize: {}, MinTouchTarget: 56 },
    '@/constants/theme': { ScreenPadding: 20, Spacing: {} },
    '@/hooks/use-settings': { useSettings: () => ({ updateSettings: () => {} }) },
    '@/lib/api': { API_URL: '', ApiError: class ApiError extends Error {} },
    '@/lib/analysis-store': {}, '@/lib/artwork-qr': {}, '@/lib/resize': {}, '@/lib/speech': {},
    '@/components/common/toast': { showToast: () => {} },
  };
  for (const [module, name] of Object.entries({ 'back-button': 'BackButton', 'bottom-sheet': 'BottomSheet', 'text-button': 'TextButton',
    'pressable-scale': 'PressableScale', text: 'Text', 'mascot-loading': 'MascotLoading' })) mocks[`@/components/common/${module}`] = { [name]: name };
  const source = fs.readFileSync(path.join(__dirname, '../../src/app/capture.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), require: (name) => { assert.ok(name in mocks, name); return mocks[name]; } });
  function render() {
    cursor = 0; const nodes = [];
    function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return;
      nodes.push(node); visit(node.props.children); }
    visit(module.exports.default()); return nodes;
  }
  let nodes = render();
  const camera = nodes.find((node) => node.type === 'CameraView');
  assert.equal(camera.props.autofocus, 'off'); // Expo 58 continuous focus, not one-shot AF lock.
  camera.props.ref.current = { takePictureAsync: (options) => {
    captures.push(options); return new Promise((resolve) => { finishPhoto = resolve; });
  } };
  const shutter = (list) => list.find((node) => node.props.a11yLabel?.startsWith('촬영해서'));
  assert.equal(shutter(nodes).props.disabled, true);
  await shutter(nodes).props.onPress();
  assert.equal(captures.length, 0);
  camera.props.onCameraReady();
  nodes = render();
  assert.equal(shutter(nodes).props.disabled, true);
  for (const fn of timers.values()) fn(); timers.clear();
  nodes = render();
  assert.equal(shutter(nodes).props.disabled, false);
  const first = shutter(nodes).props.onPress();
  const second = shutter(nodes).props.onPress();
  assert.equal(captures.length, 1);
  assert.equal(captures[0].skipProcessing, false);
  finishPhoto({ uri: 'photo.jpg', width: 4000, height: 3000 });
  await Promise.all([first, second]);
});
