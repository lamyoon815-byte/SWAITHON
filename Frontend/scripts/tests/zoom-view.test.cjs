const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function setup(playing = true, landscape = false) {
  const calls = { play: 0, pause: 0, close: 0 };
  const player = { index: 1, playing, preparing: false, error: null,
    play: () => { calls.play++; }, pause: () => { calls.pause++; } };
  const mocks = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', StyleSheet: { create: (value) => value, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
      useWindowDimensions: () => landscape ? ({ width: 844, height: 390 }) : ({ width: 390, height: 844 }) },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureRoot' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea', useSafeAreaInsets: () => ({ left: 0, right: 0, bottom: 0 }) },
    'expo-symbols': { SymbolView: 'Symbol' },
    '@/components/common/text': { Text: 'Text' },
    '@/components/common/correction-canvas': { CorrectionCanvas: 'CorrectionCanvas' },
    '@/components/common/pressable-scale': { PressableScale: 'Button' },
    '@/constants/a11y': { getPalette: () => ({}), FontSize: { body: 20, label: 18 }, ButtonHeight: 56, ButtonRadius: 16 },
    '@/constants/theme': { ScreenPadding: 20, Spacing: { two: 8, three: 16 } },
    '@/hooks/use-corrected-artwork': { useCorrectedArtwork: () => ({ source: 'original', overlay: 'corrected', overlayAmount: 1 }) },
    '@/hooks/use-zoom-orientation': { useZoomOrientation: () => landscape },
    '@/lib/calibration': { viewingFromProfile: (value) => value },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/components/artwork/zoom-view.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    assert.ok(name in mocks, `Zoom must not own a second narrator or fetch another script: ${name}`);
    return mocks[name];
  } });
  const tree = module.exports.ArtworkZoomView({
    artwork: { id: 'sample', title: '작품', artist: '작가', image_url: 'original' },
    profile: {}, strength: 1, player, sentences: ['이미 읽은 문장', '현재 읽는 문장', '다음 문장'],
    onClose: () => { calls.close++; },
  });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object' || !node.props) return;
    nodes.push(node); visit(node.props.children);
  }
  visit(tree);
  const button = (label) => nodes.find((node) => node.type === 'Button' && node.props.accessibilityLabel === label);
  return { nodes, calls, button, player };
}

test('enlarged view shows the current sentence and controls the existing narrator', () => {
  const { nodes, calls, button, player } = setup();
  assert.ok(nodes.some((node) => node.type === 'Text' && node.props.children === '현재 읽는 문장'));
  assert.ok(nodes.some((node) => node.props.accessibilityLabel === '3문장 중 2번째'));
  assert.equal(button('해설 멈추기').props.onPress, player.pause);
  assert.deepEqual(calls, { play: 0, pause: 0, close: 0 });
  button('해설 멈추기').props.onPress();
  assert.equal(calls.pause, 1);
  assert.equal(calls.play, 0);
});

test('closing enlarged view never pauses or restarts the ongoing narration', () => {
  const { calls, button } = setup();
  button('닫기').props.onPress();
  assert.deepEqual(calls, { play: 0, pause: 0, close: 1 });
});

test('a paused narrator stays paused when enlarged and uses the same play callback', () => {
  const { calls, button, player } = setup(false);
  assert.equal(button('이어서 듣기').props.onPress, player.play);
  assert.equal(calls.play, 0);
  button('이어서 듣기').props.onPress();
  assert.equal(calls.play, 1);
});

test('landscape fills the viewer without a title, caption or zoom button rows and keeps the same player', () => {
  const { nodes, calls, button, player } = setup(true, true);
  const canvas = nodes.find((node) => node.type === 'CorrectionCanvas');
  assert.equal(canvas.props.showZoomControls, false);
  assert.equal(canvas.props.zoomable, true);
  assert.equal(canvas.props.containerStyle[1].position, 'absolute');
  assert.ok(!nodes.some((node) => node.props.accessibilityRole === 'header'));
  assert.ok(!nodes.some((node) => node.props.accessibilityLiveRegion === 'polite'));
  assert.equal(button('해설 멈추기').props.onPress, player.pause);
  button('닫기').props.onPress();
  assert.deepEqual(calls, { play: 0, pause: 0, close: 1 });
});
