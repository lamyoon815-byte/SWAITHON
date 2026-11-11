const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import: ${name}`); },
    Date, Set, Map, JSON, Object, Number, Math, Promise, Uint8Array, Headers, FormData, btoa,
    setTimeout: () => 1, clearTimeout: () => {},
    process: { env: { EXPO_PUBLIC_API_URL: 'http://test.invalid:8000' } },
    ...globals,
  }, { filename: file });
  return module.exports;
}

const calibration = load('lib/calibration.ts');

test('all eight screening patterns follow the agreed color-selection rules', () => {
  const cases = [
    [[], 'normal'], [['protan'], 'protan'], [['deutan'], 'deutan'], [['tritan'], 'tritan'],
    [['protan', 'deutan'], 'deutan'], [['protan', 'tritan'], null],
    [['deutan', 'tritan'], null], [['protan', 'deutan', 'tritan'], null],
  ];
  for (const [failed, expected] of cases) assert.equal(calibration.screeningColor(failed), expected);
});

test('app brightness and low contrast remain in app units; server applies only color and edges', () => {
  const profile = { color_type: 'deutan', severity: 0.8, edge: 0.4, contrast: 0.5, brightness: -0.75, sharpness: 1.2 };
  const normalized = calibration.normalizeViewing(profile);
  assert.equal(normalized.brightness, -0.75);
  assert.equal(normalized.contrast, 0.5);
  const server = calibration.serverCorrection(profile, 0.5);
  assert.equal(server.severity, 0.4);
  assert.equal(server.edge, 0.2);
  assert.equal(server.brightness, 0);
  assert.equal(server.contrast, 1);
  assert.equal(server.sharpness, 0);
});

test('normal vision always clears color correction and invalid stored values are bounded', () => {
  const profile = calibration.normalizeViewing({ color_type: 'normal', severity: 1, contrast: 5, edge: NaN, brightness: -4 });
  assert.equal(profile.severity, 0);
  assert.equal(profile.contrast, 2);
  assert.equal(profile.edge, 0);
  assert.equal(profile.brightness, -1);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const loginResult = {
  access_token: 'session-token', token_type: 'bearer', expires_in: 604800,
  user: { id: 'user-1', nickname: '관람객', email: 'viewer@example.com', created_at: '2026-11-11' },
};

function authStore(raw = null, failSave = false) {
  const storage = { raw, deleted: false };
  const store = load('store/auth.ts', {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-secure-store': {
      getItemAsync: async () => storage.raw,
      setItemAsync: async (_, value) => { if (failSave) throw new Error('Storage unavailable'); storage.raw = value; },
      deleteItemAsync: async () => { storage.deleted = true; storage.raw = null; },
    },
  });
  store.subscribeAuth(() => {});
  return { store, storage };
}

test('successful login persists only the session and restores it on a new launch', async () => {
  const { store, storage } = authStore();
  await store.saveSession(loginResult);
  assert.equal(store.getAccessToken(), 'session-token');
  assert.equal(JSON.parse(storage.raw).user.id, 'user-1');
  assert.equal(storage.raw.includes('password'), false);
  const restored = authStore(storage.raw);
  await tick();
  assert.equal(restored.store.getAccessToken(), 'session-token');
  await restored.store.clearSession();
  assert.equal(restored.store.getAuthSnapshot().session, null);
  assert.equal(restored.storage.raw, null);
});

test('expired sessions are removed rather than restored', async () => {
  const { store, storage } = authStore(JSON.stringify({ token: 'expired', expiresAt: Date.now() - 1000, user: loginResult.user }));
  await tick();
  assert.equal(store.getAccessToken(), null);
  assert.equal(storage.deleted, true);
});

test('credential persistence failure leaves the app logged out', async () => {
  const { store } = authStore(null, true);
  await assert.rejects(store.saveSession(loginResult), /Storage unavailable/);
  assert.equal(store.getAuthSnapshot().session, null);
});

function apiClient(respond, token = 'saved-token') {
  const calls = [];
  let cleared = false;
  const api = load('lib/api.ts', {
    'expo-file-system': { File: class {} }, 'react-native': { Platform: { OS: 'ios' } },
    'expo/fetch': { fetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); } },
    '@/store/auth': { getAccessToken: () => typeof token === 'function' ? token() : token, clearSession: async () => { cleared = true; } },
    '@/lib/calibration': calibration,
  });
  return { api, calls, cleared: () => cleared };
}

test('login sends credentials without an existing bearer token', async () => {
  const { api, calls } = apiClient(() => ({ ok: true, status: 200, json: async () => loginResult }));
  await api.login('  viewer@example.com  ', 'example-password');
  assert.equal(calls[0].init.headers.get('Authorization'), null);
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'viewer@example.com', password: 'example-password' });
});

test('logout sends bearer credentials and handles 204 without parsing JSON', async () => {
  const { api, calls, cleared } = apiClient(() => ({ ok: true, status: 204, json: async () => { throw new Error('Must not parse'); } }));
  await api.logout();
  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer saved-token');
  assert.equal(cleared(), true);
});

test('a rejected saved session is cleared; failed login does not clear an unrelated session', async () => {
  const response = () => ({ ok: false, status: 401, json: async () => ({ detail: '인증 필요' }) });
  const authenticated = apiClient(response);
  await assert.rejects(authenticated.api.getCurrentUser());
  assert.equal(authenticated.cleared(), true);
  const login = apiClient(response);
  await assert.rejects(login.api.login('viewer@example.com', 'wrong-password'));
  assert.equal(login.cleared(), false);
});

test('a failed real catalog request reports its error without returning placeholder museums', async () => {
  const { api } = apiClient(() => ({ ok: false, status: 503, json: async () => ({ detail: '서버 연결 실패' }) }));
  await assert.rejects(api.getMuseums(), /서버 연결 실패/);
});

test('a late failure from an old session cannot clear a newly signed-in session', async () => {
  let token = 'old-session';
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const { api, cleared } = apiClient(() => response, () => token);
  const request = api.getCurrentUser();
  token = 'new-session';
  finish({ ok: false, status: 401, json: async () => ({ detail: '세션 만료' }) });
  await assert.rejects(request);
  assert.equal(cleared(), false);
});

test('generated narration is reused and a failed generation is never cached as playable text', async () => {
  let attempts = 0;
  const { api, calls } = apiClient(() => {
    attempts++;
    return { ok: true, status: 200, json: async () => attempts === 1
      ? { artwork_id: 'art', fallback: true, segments: [], review_status: 'unreviewed' }
      : { artwork_id: 'art', fallback: false, segments: [{ type: 'fact', text: '붉은 꽃이 있어요.', region_index: null }], review_status: 'unreviewed' } };
  });
  await assert.rejects(api.generateNarration('art'), /AI 해설을 생성하지 못했어요/);
  const [a, b] = await Promise.all([api.generateNarration('art'), api.generateNarration('art')]);
  assert.equal(a.review_status, 'unreviewed');
  assert.equal(a, b);
  await api.generateNarration('art');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'POST');
});
