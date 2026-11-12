const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(source = async (text) => `file://${text}.wav`) {
  const players = [], requests = [], device = [], errors = [], phone = [], artworkRequests = [];
  let announcementStops = 0;
  const state = {};
  const cache = new Map();
  const mocks = {
    // Phone-voice fallback: records what was spoken and finishes when the test calls the saved onDone.
    'expo-speech': { stop: async () => {}, speak: (text, options) => { phone.push({ text, options }); } },
    '@/lib/speech': {
      speakKorean: async (text, options) => { device.push({ text, options }); },
      stopSpeaking: () => { announcementStops++; },
    },
    '@/lib/speech-audio': { getSpeechAudio: (text, artworkId) => {
      const key = JSON.stringify([artworkId ?? null, text]);
      if (!cache.has(key)) {
        requests.push(text);
        artworkRequests.push({ text, artworkId });
        const pending = Promise.resolve().then(() => source(text, artworkId)).catch((error) => { cache.delete(key); throw error; });
        cache.set(key, pending);
      }
      return cache.get(key);
    } },
    'expo-audio': {
      setAudioModeAsync: async () => {},
      createAudioPlayer: (uri) => {
        let listener;
        const player = {
          uri, released: false, plays: 0, rate: 1,
          currentStatus: { isLoaded: true, playing: false, currentTime: 0, isBuffering: false, didJustFinish: false, error: null },
          addListener: (_, callback) => { listener = callback; return { remove: () => { listener = undefined; } }; },
          play() { this.plays++; this.currentStatus.playing = true; listener?.({ ...this.currentStatus }); },
          pause() { this.currentStatus.playing = false; listener?.({ ...this.currentStatus }); },
          release() { this.released = true; },
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
    (paused) => { state.paused = paused; },
  );
  const configure = (values = {}) => engine.configure({ sentences: ['첫 문장', '둘째 문장'], rate: 1, repeat: false, ...values });
  configure();
  return { engine, configure, players, requests, device, state, errors, phone, artworkRequests, stops: () => announcementStops };
}

test('artwork voice identity is forwarded to playback and prefetch and changes even for the same script', async () => {
  const h = setup((text, artworkId) => `file://${artworkId}/${text}.wav`);
  h.configure({ artworkId: 'nmk-c0002' });
  h.engine.play(); await tick();
  assert.ok(h.artworkRequests.some((r) => r.text === '첫 문장' && r.artworkId === 'nmk-c0002'));
  assert.ok(h.artworkRequests.some((r) => r.text === '둘째 문장' && r.artworkId === 'nmk-c0002'));
  h.configure({ artworkId: 'aic-08' });
  h.engine.play(); await tick();
  assert.ok(h.artworkRequests.some((r) => r.text === '첫 문장' && r.artworkId === 'aic-08'));
  assert.ok(h.players.some((p) => p.uri === 'file://aic-08/첫 문장.wav' && p.plays === 1));
  h.engine.stop();
});

test('OpenAI audio plays sentence by sentence and releases the previous player', async () => {
  const { engine, players, state } = setup();
  engine.play(); await tick();
  const first = players.find((p) => p.uri === 'file://첫 문장.wav');
  const second = players.find((p) => p.uri === 'file://둘째 문장.wav');
  assert.equal(first.plays, 1);
  assert.equal(second.plays, 0);
  assert.equal(state.preparing, false);
  first.finish(); await tick();
  assert.equal(first.released, true);
  assert.equal(second.plays, 1);
  assert.equal(state.index, 1);
  second.finish(); await tick();
  assert.equal(state.playing, false);
  assert.equal(state.index, 0);
  assert.equal(second.released, true);
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
  const before = requests.length;
  engine.changeRate(1.5);
  finishFirst('file://first.wav'); await tick();
  assert.equal(players.length, 1);
  assert.equal(players[0].uri, 'file://second.wav');
  assert.equal(players[0].rate, 1.5);
  // A speed change reuses the audio; only the two sentences were ever generated (the real cache dedupes repeats).
  assert.equal(requests.length, before);
  assert.deepEqual([...new Set(requests)].sort(), ['둘째 문장', '첫 문장'].sort());
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

test('when the AI voice fails, the sentence is read by the phone voice and narration continues', async () => {
  const { engine, phone, state, errors } = setup(async () => { throw new Error('daily limit'); });
  engine.play(); await tick();
  assert.equal(phone.length, 1);
  assert.equal(phone[0].text, '첫 문장');
  assert.equal(phone[0].options.language, 'ko-KR');
  assert.equal(state.playing, true);
  assert.equal(errors.filter(Boolean).length, 0);
  phone[0].options.onDone(); await tick();
  assert.equal(state.index, 1);  // moves on and tries the next sentence (AI first, then phone)
  assert.equal(phone.at(-1).text, '둘째 문장');
  engine.stop();
});

test('narration prefetches the next sentence so it plays without a gap', async () => {
  const { engine, requests, players } = setup();
  assert.deepEqual(requests, ['첫 문장']);  // ready before play is pressed
  engine.play(); await tick();
  assert.ok(requests.includes('둘째 문장'));
  const first = players.find((p) => p.uri === 'file://첫 문장.wav');
  const second = players.find((p) => p.uri === 'file://둘째 문장.wav');
  assert.equal(second.plays, 0);
  first.finish(); await tick();
  assert.equal(second.plays, 1);
  assert.equal(players.length, 2); // Reuses the already loaded player.
  engine.stop();
});

test('narration always uses GPT audio and first stops any screen announcement', async () => {
  const { engine, requests, device, players, stops } = setup();
  engine.play(); await tick();
  assert.equal(stops(), 1);
  // The first sentence is played and the next one is prepared in the background.
  assert.equal(requests[0], '첫 문장');
  assert.ok(requests.includes('둘째 문장'));
  assert.equal(device.length, 0);
  assert.equal(players.find((p) => p.uri === 'file://첫 문장.wav').plays, 1);
  engine.stop();
});


test('lookahead buffers two sentences without generating the entire narration', async () => {
  const { engine, configure, requests, players } = setup();
  configure({ sentences: ['첫 문장', '둘째 문장', '셋째 문장', '넷째 문장', '다섯째 문장'] });
  engine.play(); await tick();
  assert.deepEqual(requests, ['첫 문장', '둘째 문장', '셋째 문장']);
  assert.equal(players.filter((p) => p.plays > 0).length, 1);
  const next = players.find((p) => p.uri === 'file://둘째 문장.wav');
  assert.ok(next);
  engine.stop();
  assert.ok(players.every((p) => p.released));
  assert.ok(!requests.includes('넷째 문장'));
});

test('stopping a pending lookahead does not create a late player or queue more sentences', async () => {
  let resolveNext;
  const { engine, configure, requests, players } = setup((text) => text === '둘째 문장'
    ? new Promise((resolve) => { resolveNext = resolve; }) : Promise.resolve(`file://${text}.wav`));
  configure({ sentences: ['첫 문장', '둘째 문장', '셋째 문장'] });
  engine.play(); await tick();
  engine.stop();
  resolveNext('file://둘째 문장.wav'); await tick();
  assert.equal(players.length, 1);
  assert.equal(players[0].released, true);
  assert.ok(!requests.includes('셋째 문장'));
});

test('changing later sentences with the same opening stops and discards old prepared audio', async () => {
  const { engine, configure, players, state } = setup();
  engine.play(); await tick();
  configure({ sentences: ['첫 문장', '새로운 해설'] });
  assert.equal(state.playing, false);
  assert.equal(state.index, 0);
  assert.ok(players.every((p) => p.released));
  engine.play(); await tick();
  assert.ok(players.some((p) => p.uri === 'file://새로운 해설.wav' && !p.released));
  engine.stop();
});


test('pause and resume preserve the exact audio position, player and prepared next sentence', async () => {
  const { engine, players, requests, state } = setup();
  engine.play(); await tick();
  const current = players.find((p) => p.uri === 'file://첫 문장.wav');
  current.currentStatus.currentTime = 3.75;
  const before = requests.length;
  engine.pause();
  assert.equal(state.playing, false);
  assert.equal(state.paused, true);
  assert.equal(current.released, false);
  assert.equal(current.currentStatus.currentTime, 3.75);
  engine.play(); await tick();
  assert.equal(state.paused, false);
  assert.equal(current.plays, 2);
  assert.equal(current.currentStatus.currentTime, 3.75);
  assert.equal(players.filter((p) => p.uri === current.uri).length, 1);
  assert.equal(requests.length, before);
  engine.stop();
});

test('pausing while generating loads audio silently and resumes only when play is pressed', async () => {
  let finishFirst;
  const { engine, players, state } = setup((text) => text === '첫 문장'
    ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve(`file://${text}.wav`));
  engine.play(); await tick();
  engine.pause();
  finishFirst('file://첫 문장.wav'); await tick();
  const first = players.find((p) => p.uri === 'file://첫 문장.wav');
  assert.equal(first.plays, 0);
  assert.equal(state.playing, false);
  assert.equal(state.paused, true);
  engine.play(); await tick();
  assert.equal(first.plays, 1);
  assert.equal(state.playing, true);
  engine.stop();
});

test('completion fires once only after the last sentence is heard to the end', async () => {
  const { engine, players } = setup();
  let completed = 0;
  engine.setOnComplete(() => { completed++; });
  engine.play(); await tick();
  players.find((p) => p.uri === 'file://첫 문장.wav').finish(); await tick();
  assert.equal(completed, 0);
  players.find((p) => p.uri === 'file://둘째 문장.wav').finish(); await tick();
  assert.equal(completed, 1);
});

test('stopping midway or repeating a sentence is not a completion', async () => {
  const { engine, players, configure } = setup();
  let completed = 0;
  engine.setOnComplete(() => { completed++; });
  engine.play(); await tick();
  engine.stop(); await tick();
  assert.equal(completed, 0);
  configure({ repeat: true });
  engine.speakAt(1); await tick();
  players.filter((p) => p.uri === 'file://둘째 문장.wav').at(-1).finish(); await tick();
  assert.equal(completed, 0);
});
