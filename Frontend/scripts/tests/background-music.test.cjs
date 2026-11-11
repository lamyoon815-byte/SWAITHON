// node --test scripts/tests/background-music.test.cjs  (해설 배경 음악: 켜고 끄기, 페이드, 실패 처리)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const players = [];
  let now = 0, nextId = 1;
  const timers = new Map();
  const clock = {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms, every: ms }); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      now = t.at;
      if (t.every) t.at += t.every; else timers.delete(id);
      t.fn();
    }
    now = end;
  };
  const mocks = {
    'expo-audio': {
      createAudioPlayer: (uri) => {
        let listener;
        const player = {
          uri, loop: false, volume: 1, playing: false, released: false, plays: 0,
          addListener: (_, callback) => { listener = callback; return { remove: () => { listener = undefined; } }; },
          play() { this.plays++; this.playing = true; }, pause() { this.playing = false; },
          release() { this.released = true; },
          fail() { listener?.({ error: 'load failed' }); },
        };
        players.push(player);
        return player;
      },
    },
  };
  const file = path.join(__dirname, '../../src/lib/background-music.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Math, Set, ...clock, require: (name) => mocks[name] });
  return { lib: module.exports, music: new module.exports.BackgroundMusic(), players, advance };
}

const URL_A = 'https://api.example/music/calm';
const URL_B = 'https://api.example/music/sacred';

test('해설이 재생되면 음악을 반복 재생하며 작은 소리까지 천천히 키운다', () => {
  const { lib, music, players, advance } = setup();
  music.update(URL_A, false);
  assert.equal(players.length, 0); // 해설을 틀기 전에는 음악을 받지 않는다.
  music.update(URL_A, true);
  assert.equal(players.length, 1);
  assert.equal(players[0].loop, true);
  assert.equal(players[0].playing, true);
  assert.equal(players[0].volume, 0);
  advance(lib.FADE_IN_MS / 2);
  assert.ok(players[0].volume > 0 && players[0].volume < lib.MUSIC_VOLUME);
  advance(lib.FADE_IN_MS);
  assert.ok(Math.abs(players[0].volume - lib.MUSIC_VOLUME) < 1e-9);
  music.update(URL_A, true); // 같은 값으로 다시 불러도 아무 일 없다.
  assert.equal(players[0].plays, 1);
});

test('문장 사이처럼 잠깐 끊기면 그대로 두고, 멈추면 잠깐 뒤 줄여서 멈춘다', () => {
  const { lib, music, players, advance } = setup();
  music.update(URL_A, true); advance(lib.FADE_IN_MS);
  music.update(URL_A, false); advance(lib.LINGER_MS / 2);
  music.update(URL_A, true); advance(lib.LINGER_MS * 2);
  assert.equal(players[0].playing, true);
  assert.ok(Math.abs(players[0].volume - lib.MUSIC_VOLUME) < 1e-9);
  music.update(URL_A, false); advance(lib.LINGER_MS + lib.FADE_OUT_MS + 200);
  assert.equal(players[0].playing, false);
  assert.equal(players[0].volume, 0);
  assert.equal(players[0].released, false); // 다시 틀면 이어서 재생
  music.update(URL_A, true);
  assert.equal(players.length, 1);
  assert.equal(players[0].playing, true);
});

test('음악이 바뀌거나 꺼지거나 화면을 떠나면 바로 정리한다', () => {
  const { music, players } = setup();
  music.update(URL_A, true);
  music.update(URL_B, true);
  assert.equal(players[0].released, true);
  assert.equal(players[1].uri, URL_B);
  assert.equal(players[1].playing, true);
  music.update(null, true); // 배경 음악 끔
  assert.equal(players[1].released, true);
  music.update(URL_A, true);
  music.dispose();
  assert.equal(players[2].released, true);
  assert.equal(players[2].playing, false);
});

test('음악을 못 불러오면 조용히 멈추고 같은 주소는 다시 시도하지 않는다', () => {
  const { music, players } = setup();
  music.update(URL_A, true);
  players[0].fail();
  assert.equal(players[0].released, true);
  music.update(URL_A, false);
  music.update(URL_A, true);
  assert.equal(players.length, 1);
});
