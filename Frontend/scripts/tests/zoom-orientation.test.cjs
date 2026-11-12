const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function setup() {
  let state = null, source, effectCleanup, focusCleanup;
  const measurements = [], options = [];
  const navigation = { setOptions: (value) => options.push(value.orientation) };
  const mocks = {
    react: {
      useState: () => [state, (value) => { state = value; }],
      useCallback: (fn) => fn,
      useEffect: (fn, deps) => {
        if (deps[0] !== source) {
          effectCleanup?.(); source = deps[0]; effectCleanup = fn();
        }
      },
    },
    'react-native': { Image: { getSize: (uri, success, error) => measurements.push({ uri, success, error }) } },
    'expo-router': {
      useNavigation: () => navigation,
      useFocusEffect: (fn) => { focusCleanup?.(); focusCleanup = fn(); },
    },
  };
  const input = fs.readFileSync(path.join(__dirname, '../../src/hooks/use-zoom-orientation.ts'), 'utf8');
  const js = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    assert.ok(name in mocks, name); return mocks[name];
  } });
  return { measurements, options, render: (uri, force) => module.exports.useZoomOrientation(uri, force),
    close: () => { effectCleanup?.(); focusCleanup?.(); } };
}

test('wide artwork allows device rotation only after dimensions are known; closing restores portrait', () => {
  const h = setup();
  assert.equal(h.render('wide'), false);
  assert.equal(h.options.at(-1), 'portrait');
  h.measurements[0].success(1600, 1000);
  assert.equal(h.render('wide'), true);
  assert.equal(h.options.at(-1), 'default');
  h.close();
  assert.equal(h.options.at(-1), 'portrait');
});

test('portrait, square, invalid dimensions and failed downloads keep portrait', () => {
  for (const dimensions of [[900, 1200], [1000, 1000], [1000, 0]]) {
    const h = setup(); h.render('image'); h.measurements[0].success(...dimensions);
    assert.equal(h.render('image'), false);
    assert.equal(h.options.at(-1), 'portrait');
    h.close();
  }
  const h = setup(); h.render('failed'); h.measurements[0].error();
  assert.equal(h.render('failed'), false);
  assert.equal(h.options.at(-1), 'portrait');
});

test('switching from wide to portrait artwork ignores late results and locks portrait immediately', () => {
  const h = setup(); h.render('old-wide');
  const old = h.measurements[0]; old.success(1600, 900); h.render('old-wide');
  assert.equal(h.render('new-portrait'), false);
  assert.equal(h.options.at(-1), 'portrait');
  old.success(2000, 900);
  assert.equal(h.render('new-portrait'), false);
  h.close();
});

test('image-only viewing forces wide art to landscape without waiting for a device rotation', () => {
  const h = setup(); h.render('wide', true);
  h.measurements[0].success(1600, 900);
  assert.equal(h.render('wide', true), true);
  assert.equal(h.options.at(-1), 'landscape');
  h.close();
  assert.equal(h.options.at(-1), 'portrait');
});

test('image-only viewing never forces portrait art to landscape', () => {
  const h = setup(); h.render('portrait', true);
  h.measurements[0].success(900, 1600);
  assert.equal(h.render('portrait', true), false);
  assert.equal(h.options.at(-1), 'portrait');
  h.close();
});
