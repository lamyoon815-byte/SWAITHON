const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

test('opening and closing fullscreen keeps the narrator and music active without navigation or a native modal', () => {
  const states = [];
  let cursor = 0;
  const music = [], playbackCalls = [], navigation = [];
  const player = { index: 0, playing: true, preparing: false, paused: false, error: null,
    play: () => playbackCalls.push('play'), pause: () => playbackCalls.push('pause'),
    reset: () => playbackCalls.push('reset'), goTo: () => {}, changeRate: () => {} };
  const profile = { strength: 1, speech_rate: 1, narration_mode: 'both', narration_length: 'brief', narration_focus: 'balanced' };
  const artwork = { id: 'sample', title: '작품', artist: '작가', image_url: 'original', description: { regions: [] } };
  const segments = [{ type: 'fact', text: '읽고 있는 문장', region_index: null }];
  const value = (initial) => ({ get: () => initial, set: () => {} });
  const component = (name) => ({ [name]: name });
  const mocks = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    react: {
      useState: (initial) => { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
        return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }]; },
      useRef: (current) => ({ current }), useEffect: () => {},
    },
    'expo-router': { useLocalSearchParams: () => ({ id: 'sample' }), router: { push: () => navigation.push('push') } },
    'expo-symbols': component('SymbolView'),
    'react-native': { View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Switch: 'Switch', Modal: 'NativeModal',
      ActivityIndicator: 'ActivityIndicator', Image: {}, BackHandler: {},
      StyleSheet: { create: (v) => v, absoluteFill: {} }, useWindowDimensions: () => ({ height: 844, width: 390 }) },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', usePanGesture: () => ({}), usePinchGesture: () => ({}), useSimultaneousGestures: () => ({}) },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: value, useAnimatedStyle: (fn) => fn(), useReducedMotion: () => false,
      FadeIn: { duration: () => ({}) }, FadeOut: { duration: () => ({}) } },
    'react-native-worklets': { scheduleOnRN: () => {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/constants/a11y': { getPalette: () => ({}), FontSize: {}, MinTouchTarget: 56 },
    '@/constants/theme': { ScreenPadding: 20, Spacing: { one: 4, two: 8, three: 16 } },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
    '@/hooks/use-profile': { useProfile: () => ({ profile, loaded: true }) },
    '@/hooks/use-settings': { useSettings: () => ({ settings: { background_music: true }, loaded: true, updateSettings: () => {} }) },
    '@/hooks/use-corrected-artwork': { useCorrectedArtwork: () => ({ source: 'original', overlay: 'corrected' }) },
    '@/hooks/use-narration-player': { useNarrationPlayer: () => player },
    '@/hooks/use-background-music': { useBackgroundMusic: (...args) => music.push(args) },
    '@/hooks/use-resource': { useResource: (key) => ({ data: key === 'sample' ? artwork : key?.startsWith('narration:') ? { segments }
      : key?.startsWith('mood:') ? { music_url: 'music.wav', name: '평온' } : undefined }) },
    '@/lib/api': { ApiError: class ApiError extends Error {} },
    '@/lib/calibration': { correctionStrength: (v) => v, viewingFromProfile: (v) => v },
    '@/lib/follow-zoom': { FOLLOW_FILL: 0.92, FOLLOW_MAX: 6 },
    '@/lib/pending-feedback': { markFeedbackPending: () => {} },
    '@/components/narration/speed-sheet': { SpeedSheet: 'SpeedSheet', formatRate: () => '1배' },
  };
  for (const [module, name] of Object.entries({
    'common/text': 'Text', 'artwork/zoom-view': 'ArtworkZoomView', 'common/back-button': 'BackButton', 'common/big-button': 'BigButton',
    'common/bottom-sheet': 'BottomSheet', 'common/bottom-action-bar': 'BottomActionBar', 'common/correction-canvas': 'CorrectionCanvas',
    'common/segmented-control': 'SegmentedControl', 'common/pressable-scale': 'PressableScale', 'narration/region-overlay': 'RegionOverlay', 'narration/seek-bar': 'SeekBar',
    'common/mascot-loading': 'MascotLoading',
  })) mocks[`@/components/${module}`] = component(name);
  const source = fs.readFileSync(path.join(__dirname, '../../src/app/(tabs)/(home)/artwork/[id]/narration.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Math, Set, Error, require: (name) => {
    assert.ok(name in mocks, `Missing integration mock: ${name}`); return mocks[name];
  } });
  function render() {
    cursor = 0;
    const nodes = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      nodes.push(node); visit(node.props.children);
    }
    visit(module.exports.default()); return nodes;
  }
  let nodes = render();
  nodes.find((node) => node.props.accessibilityLabel === '작품 크게 보기').props.onPress();
  nodes = render();
  const fullscreen = nodes.find((node) => node.type === 'ArtworkZoomView');
  assert.ok(fullscreen);
  assert.equal(fullscreen.props.player, player);
  assert.deepEqual(Array.from(fullscreen.props.sentences), ['읽고 있는 문장']);
  assert.ok(!nodes.some((node) => node.type === 'NativeModal'));
  assert.ok(nodes.some((node) => node.type === 'SafeAreaView' && node.props.pointerEvents === 'none'));
  assert.deepEqual(playbackCalls, []);
  assert.deepEqual(navigation, []);
  assert.ok(music.every(([url, active, enabled]) => url === 'music.wav' && active && enabled));
  fullscreen.props.onClose();
  nodes = render();
  assert.ok(!nodes.some((node) => node.type === 'ArtworkZoomView'));
  assert.deepEqual(playbackCalls, []);
  assert.ok(music.every(([, active, enabled]) => active && enabled));
  player.playing = false; player.paused = true;
  render();
  assert.deepEqual(music.at(-1), ['music.wav', false, true, true]);
  player.playing = true; player.paused = false;
  render();
  assert.deepEqual(music.at(-1), ['music.wav', true, true, false]);
});
