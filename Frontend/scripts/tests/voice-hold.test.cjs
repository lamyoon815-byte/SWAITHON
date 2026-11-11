const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(permission = Promise.resolve({ granted: true })) {
  const calls = { record: 0, stop: 0, transcribe: 0, states: [], timers: 0 };
  let cleanup;
  const recorder = {
    uri: 'file:///answer.m4a',
    prepareToRecordAsync: async () => {},
    record: () => { calls.record++; },
    stop: async () => { calls.stop++; },
  };
  const mocks = {
    react: {
      useRef: (current) => ({ current }), useState: (initial) => [initial, (state) => calls.states.push(state)],
      useCallback: (fn) => fn, useEffect: () => {},
    },
    'expo-router': { useFocusEffect: (fn) => { cleanup = fn(); } },
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} }, useAudioRecorder: () => recorder,
      requestRecordingPermissionsAsync: () => permission, setAudioModeAsync: async () => {},
    },
    '@/lib/speech': { stopSpeaking: () => {} },
    '@/lib/api': {
      ApiError: class extends Error {},
      transcribeAnswer: async () => { calls.transcribe++; return '12번'; },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/hooks/use-voice-answer.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (name) => mocks[name],
    setTimeout: () => { calls.timers++; return 1; }, clearTimeout: () => {},
  });
  return { voice: module.exports.useVoiceAnswer('artwork'), calls, leave: () => cleanup() };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const handlers = { onText: () => {}, onError: (message) => assert.fail(message) };

test('hold records until release, then transcribes exactly once', async () => {
  const { voice, calls } = setup();
  voice.startHolding(handlers);
  await flush();
  assert.equal(calls.record, 1);
  assert.equal(calls.transcribe, 0);
  assert.equal(calls.timers, 0);
  voice.stopHolding();
  voice.stopHolding();
  assert.equal(calls.states.at(-1), 'thinking');
  await flush();
  assert.equal(calls.stop, 1);
  assert.equal(calls.transcribe, 1);
});

test('release while permission is pending does not start late recording', async () => {
  let grant;
  const { voice, calls } = setup(new Promise((resolve) => { grant = resolve; }));
  voice.startHolding(handlers);
  voice.stopHolding();
  grant({ granted: true });
  await flush();
  assert.equal(calls.record, 0);
  assert.equal(calls.transcribe, 0);
});

test('leaving during permission request cancels recording', async () => {
  let grant;
  const { voice, calls, leave } = setup(new Promise((resolve) => { grant = resolve; }));
  voice.startHolding(handlers);
  leave();
  grant({ granted: true });
  await flush();
  assert.equal(calls.record, 0);
});

test('existing toggle interaction keeps its automatic stop timer', async () => {
  const { voice, calls } = setup();
  voice.toggle(handlers);
  await flush();
  assert.equal(calls.record, 1);
  assert.equal(calls.timers, 1);
  voice.toggle(handlers);
  await flush();
  assert.equal(calls.transcribe, 1);
});
