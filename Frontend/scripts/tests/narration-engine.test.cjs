const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(source = async (text) => `file://${text}.wav`) {
  const players = [], requests = [], device = [], errors = [];
  const state = {};
  const mocks = {
    'expo-speech': { stop: async () => {} },
    '@/lib/speech': { speakKorean: async (text, options) => { device.push({ text, options }); } },
    '@/lib/speech-audio': { getSpeechAudio: (text) => { requests.push(text); return source(text); } },
    'expo-audio': {
      setAudioModeAsync: async () => {},
      createAudioPlayer: (uri) => {
        let listener;
        const player = {
          uri, released: false, plays: 0, rate: 1,
          currentStatus: { isLoaded: true, playing: false, currentTime: 0, isBuffering: false, didJustFinish: false, error: null },
          addListener: (_, callback) => { listener = callback; return { remove: () => { listener = undefined; } }; },
          play() { this.plays++; listener?.({ ...this.currentStatus, playing: true }); },
          pause() {}, release() { this.released = true; },
          setPlaybackRate(rate) { this.rate = rate; },
          finish() { listener?.({ ...this.currentStatus, didJustFinish: true, currentTime: 1 }); },
          fail() { listener?.({ ...this.currentStatus, error: 'Audio load failed' }); },
        };
        players.push(player); return player;
      },
    },
  };
  const file = path.join(__dirname, '../../src/lib/narration-engine.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Error, require: (name) => mocks[name] });
  const engine = new module.exports.NarrationEngine(
    (index) => { state.index = index; }, (playing) => { state.playing = playing; },
    (preparing) => { state.preparing = preparing; }, (error) => { errors.push(error); },
  );
  const configure = (values = {}) => engine.configure({ sentences: ['첫 문장', '둘째 문장'], rate: 1, repeat: false, voice: 'openai', ...values });
  configure();
  return { engine, configure, players, requests, device, state, errors };
}

test('OpenAI audio plays sentence by sentence and releases the previous player', async () => {
  const { engine, players, state } = setup();
  engine.play(); await tick();
  assert.equal(players[0].plays, 1);
  assert.equal(state.preparing, false);
  players[0].finish(); await tick();
  assert.equal(players[0].released, true);
  assert.equal(state.index, 1);
  players[1].finish(); await tick();
  assert.equal(state.playing, false);
  assert.equal(state.index, 0);
  assert.equal(players[1].released, true);
});

test('stopping while audio is being generated prevents late autoplay', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { engine, players, state } = setup(() => pending);
  engine.play(); await tick();
  engine.stop(); resolve('file://late.wav'); await tick();
  assert.equal(players.length, 0);
  assert.equal(state.playing, false);
});

test('skipping ignores a slow previous sentence and speed changes do not generate again', async () => {
  let finishFirst;
  const { engine, players, requests } = setup((text) => text === '첫 문장'
    ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve('file://second.wav'));
  engine.play(); await tick();
  engine.goTo(1); await tick();
  engine.changeRate(1.5);
  finishFirst('file://first.wav'); await tick();
  assert.equal(players.length, 1);
  assert.equal(players[0].uri, 'file://second.wav');
  assert.equal(players[0].rate, 1.5);
  assert.equal(requests.length, 2);
  engine.stop();
});

test('repeat stays on the current sentence and native failures stop playback', async () => {
  const { engine, configure, players, state, errors } = setup();
  configure({ repeat: true });
  engine.play(); await tick();
  players[0].finish(); await tick();
  assert.equal(state.index, 0);
  assert.equal(players[1].uri, players[0].uri);
  players[1].fail();
  assert.equal(state.playing, false);
  assert.ok(errors.at(-1));
});

test('an OpenAI failure is visible and never silently falls back to the old voice', async () => {
  const { engine, errors, device, state } = setup(async () => { throw new Error('OpenAI key missing'); });
  engine.play(); await tick();
  assert.equal(errors.at(-1), 'OpenAI key missing');
  assert.equal(state.playing, false);
  assert.equal(device.length, 0);
});

test('explicit device voice selection uses the existing Korean speech engine', async () => {
  const { engine, configure, requests, device } = setup();
  configure({ voice: 'device', rate: 0.9 });
  engine.play(); await tick();
  assert.equal(requests.length, 0);
  assert.equal(device[0].text, '첫 문장');
  assert.equal(device[0].options.rate, 0.9);
  engine.stop();
});
