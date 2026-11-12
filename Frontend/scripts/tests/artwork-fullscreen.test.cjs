const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

test('image-only viewer fills the display, keeps correction percentage, and only offers close', () => {
  const orientation = [];
  let closed = false;
  const mocks = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', StyleSheet: { create: (v) => v } },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureRoot' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 50 }) },
    'expo-symbols': { SymbolView: 'Symbol' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    '@/components/common/correction-canvas': { CorrectionCanvas: 'Canvas' },
    '@/components/common/pressable-scale': { PressableScale: 'Button' },
    '@/components/common/text': { Text: 'Text' },
    '@/constants/a11y': { getPalette: () => ({}), MinTouchTarget: 56 },
    '@/hooks/use-corrected-artwork': { useCorrectedArtwork: () => ({ source: 'original', overlay: 'corrected', overlayAmount: 0.54 }) },
    '@/hooks/use-zoom-orientation': { useZoomOrientation: (...args) => orientation.push(args) },
    '@/lib/calibration': { viewingFromProfile: (p) => p },
  };
  const input = fs.readFileSync(path.join(__dirname, '../../src/components/artwork/fullscreen-view.tsx'), 'utf8');
  const js = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Math, require: (name) => {
    assert.ok(name in mocks, `Image-only viewing must not fetch or create narration: ${name}`); return mocks[name];
  } });
  const tree = module.exports.ArtworkFullscreenView({ artwork: { id: 'wide', image_url: 'wide.jpg', title: '작품', artist: '작가' },
    profile: {}, original: false, strength: 0.54, onClose: () => { closed = true; } });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props) return;
    nodes.push(node); visit(node.props.children);
  }
  visit(tree);
  assert.deepEqual(orientation, [['wide.jpg', true]]);
  const canvas = nodes.find((n) => n.type === 'Canvas');
  assert.equal(canvas.props.showZoomControls, false);
  assert.equal(canvas.props.overlayAmount, 0.54);
  assert.equal(canvas.props.correction.strength, 0.54);
  assert.equal(canvas.props.style.flex, 1);
  assert.equal(canvas.props.zoomable, true);
  assert.ok(nodes.find((n) => n.type === 'StatusBar').props.hidden);
  assert.ok(!nodes.some((n) => n.type === 'Text'));
  const buttons = nodes.filter((n) => n.type === 'Button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.style[1].right, 50);
  buttons[0].props.onPress();
  assert.equal(closed, true);
});
