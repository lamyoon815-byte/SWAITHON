const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Set,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {}, require(name) {
    assert.ok(name in mocks, `Missing mock: ${name}`);
    return mocks[name];
  } });
  return module.exports;
}

function hooks() {
  const states = [], deps = [];
  let cursor = 0, effects = [];
  return {
    react: {
      useState(value) {
        const i = cursor++;
        if (!(i in states)) states[i] = typeof value === 'function' ? value() : value;
        return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
      },
      useEffect(fn, dependencies) {
        const i = cursor++;
        if (!deps[i] || dependencies.some((v, j) => v !== deps[i][j])) { deps[i] = dependencies; effects.push(fn); }
      },
    },
    render(fn) { cursor = 0; effects = []; const tree = fn(); effects.forEach(f => f()); return tree; },
  };
}

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };

test('finishing analysis waits until exit, then shows feedback on camera and retake routes once', () => {
  const pending = load('lib/pending-feedback.ts');
  let complete;
  const entry = { photoUri: 'file://art.jpg', result: { warning: '', segments: [{ type: 'fact', text: '그림 해설' }] } };
  const mocks = {
    'react/jsx-runtime': jsx,
    'react': hooks().react,
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' },
    'expo-router': { router: { replace() {} }, useLocalSearchParams: () => ({ id: 'capture-1' }) },
    'react-native': { ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: v => v }, useWindowDimensions: () => ({ height: 800 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/constants/a11y': { getPalette: () => ({}), FontSize: {}, MinTouchTarget: 56 },
    '@/constants/theme': { MaxContentWidth: 560, ScreenPadding: 20, Spacing: {} },
    '@/hooks/use-profile': { useProfile: () => ({ profile: { speech_rate: 1 } }) },
    '@/hooks/use-narration-player': { useNarrationPlayer: (_sentences, _rate, _repeat, onComplete) => { complete = onComplete; return {}; } },
    '@/lib/analysis-store': { getAnalysis: () => entry }, '@/lib/pending-feedback': pending,
  };
  for (const name of ['back-button', 'big-button', 'bottom-action-bar', 'pressable-scale', 'text', 'text-button']) {
    const exported = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
    mocks[`@/components/common/${name}`] = { [exported]: exported };
  }
  const analysis = load('app/analysis.tsx', mocks);
  const hostHooks = hooks();
  const { AnalysisFeedbackHost } = load('components/feedback/analysis-feedback-host.tsx', {
    'react': hostHooks.react, 'react/jsx-runtime': jsx,
    '@/components/feedback/feedback-sheet': { FeedbackSheet: 'FeedbackSheet' },
    '@/constants/a11y': mocks['@/constants/a11y'], '@/hooks/use-profile': mocks['@/hooks/use-profile'],
    '@/lib/pending-feedback': pending,
  });
  const host = pathname => hostHooks.render(() => AnalysisFeedbackHost({ pathname }));
  analysis.default();
  assert.equal(pending.takePendingFeedback(), null, 'reading alone must not count as completing playback');
  complete();
  assert.equal(host('/analysis'), null, 'do not interrupt the last sentence with a survey');
  assert.equal(host('/camera'), null);
  let sheet = host('/camera');
  assert.equal(sheet.type, 'FeedbackSheet');
  assert.equal(sheet.props.item.artworkId, null);
  assert.equal(sheet.props.item.analysisId, 'capture-1');
  sheet.props.onClose();
  complete();
  assert.equal(host('/capture'), null, 'replaying the same completed analysis must not ask again');
  pending.markFeedbackPending({ artworkId: null, analysisId: 'capture-2', title: '촬영한 작품' });
  host('/analysis'); host('/capture'); sheet = host('/capture');
  assert.equal(sheet.props.item.analysisId, 'capture-2', 'retake exits can show feedback for another analysis');
});
