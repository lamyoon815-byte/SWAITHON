const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup({ downloadError = false, decodeError = false } = {}) {
  const uris = [], modules = [], image = {};
  const mocks = {
    'expo-asset': { Asset: { fromModule(id) {
      modules.push(id);
      return { async downloadAsync() {
        if (downloadError) throw new Error('download failed');
        return { uri: 'http://dev-server/preview.jpg', localUri: 'file:///preview.jpg' };
      } };
    } } },
    '@shopify/react-native-skia': { Skia: {
      Data: { fromURI: async (uri) => { uris.push(uri); return {}; }, fromBytes: (bytes) => bytes },
      Image: { MakeImageFromEncoded: () => decodeError ? null : image },
    } },
  };
  const module = { exports: {} };
  const source = fs.readFileSync('src/lib/load-canvas-image.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: (name) => mocks[name], Uint8Array });
  return { load: module.exports.loadCanvasImage, uris, modules, image };
}
test('bundled preview is downloaded and decoded from its device file', async () => {
  const s = setup();
  assert.equal(await s.load(42), s.image);
  assert.deepEqual(s.modules, [42]);
  assert.deepEqual(s.uris, ['file:///preview.jpg']);
});
test('remote, byte, empty and interop sources retain their behavior', async () => {
  const s = setup();
  assert.equal(await s.load('https://api.example/image.jpg'), s.image);
  assert.equal(await s.load(new Uint8Array([1])), s.image);
  assert.equal(await s.load(null), null);
  assert.equal(await s.load({ default: 43 }), s.image);
  assert.deepEqual(s.modules, [43]);
});
test('download and decode failures reject so the UI can offer a retry', async () => {
  await assert.rejects(setup({ downloadError: true }).load(42));
  await assert.rejects(setup({ decodeError: true }).load(42));
});
