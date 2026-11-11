// node scripts/tests/voice-search.test.cjs  (작품 음성 검색 규칙 확인. TS를 transpile해서 불러온다)
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/lib', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, (name) => modules[name]);
  return mod.exports;
}

const spoken = load('spoken-answer.ts');
const { findArtworksBySpeech } = load('voice-search.ts', { '@/lib/spoken-answer': spoken });
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../Backend/catalog.artworks.json'), 'utf8'));
const museum = (id) => catalog.filter((a) => a.museum_id === id).map((a) => ({ ...a, original_title: a.original_title ?? null, original_artist: a.original_artist ?? null }));
const ids = (result) => (result.kind === 'artworks' ? result.items.map((a) => a.id) : result);

const aic = museum('aic');
const met = museum('met');
const nga = museum('nga');
assert.deepStrictEqual(ids(findArtworksBySpeech('수련', aic)), ['aic-05']);
assert.deepStrictEqual(ids(findArtworksBySpeech('모네 수련 찾아줘', aic)), ['aic-05']);
assert.deepStrictEqual(ids(findArtworksBySpeech('침실 보여 주세요.', aic)), ['aic-02']);
assert.deepStrictEqual(ids(findArtworksBySpeech('그랑드 자트 섬의 일요일 오후', aic)), ['aic-01']);
assert.deepStrictEqual(ids(findArtworksBySpeech('그랑드 자트 섬', aic)), ['aic-01']);
assert.deepStrictEqual(ids(findArtworksBySpeech('붉은 후지산', aic)), ['aic-06']);
assert.deepStrictEqual(ids(findArtworksBySpeech('파리의 거리 비오는날', aic)), ['aic-03']);
assert.deepStrictEqual(ids(findArtworksBySpeech('거대한 파도', met)), ['met-04']);
assert.deepStrictEqual(ids(findArtworksBySpeech('파도', met)), ['met-04']);
assert.deepStrictEqual(ids(findArtworksBySpeech('사자의 식사 작품', met)), ['met-03']);
assert.deepStrictEqual(ids(findArtworksBySpeech('물뿌리게를 든 소녀', nga)), ['nga-03']); // 받아쓰기 오타
assert.deepStrictEqual(ids(findArtworksBySpeech('세 개의 십자가', nga)), ['nga-07']);
assert.deepStrictEqual(ids(findArtworksBySpeech('고흐', nga)).sort(), ['nga-01', 'nga-02']);
assert.deepStrictEqual(ids(findArtworksBySpeech('모네', nga)), ['nga-04']);
assert.deepStrictEqual(ids(findArtworksBySpeech('Water Lilies', aic)), ['aic-05']);
assert.deepStrictEqual(findArtworksBySpeech('5번', aic), { kind: 'number', number: '5' });
assert.deepStrictEqual(findArtworksBySpeech('오 번', aic), { kind: 'number', number: '5' });
assert.deepStrictEqual(findArtworksBySpeech('12번 보여줘', aic), { kind: 'number', number: '12' });
assert.deepStrictEqual(findArtworksBySpeech('오늘 날씨 어때', aic), { kind: 'none' });
assert.deepStrictEqual(findArtworksBySpeech('', aic), { kind: 'none' });
console.log('voice-search: ok');
