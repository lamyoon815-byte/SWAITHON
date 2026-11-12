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

const calibrationTypes = load('types/calibration.ts');
const calibration = load('lib/calibration.ts', { '@/types/calibration': calibrationTypes });
const correctionSettingsLib = load('lib/correction-settings.ts', {
  '@/assets/images/calibration': { CALIBRATION: {} }, '@/types/calibration': calibrationTypes,
});

test('color types keep independent levels when switching, disabling, and returning to a previous type', () => {
  const { correctionSettings, updateCorrectionSettings, correctionSettingsChanged } = correctionSettingsLib;
  const { DEFAULT_PROFILE } = load('types/profile.ts');
  let values = correctionSettings({ ...DEFAULT_PROFILE, calibration: { color_type: 'protan', severity: 0.4, edge: 0.2 } });
  const saved = structuredClone(values);
  values = updateCorrectionSettings(values, { color_type: 'deutan' });
  assert.equal(values.severity, 0);
  values = updateCorrectionSettings(values, { severity: 0.8 });
  values = updateCorrectionSettings(values, { color_type: 'tritan' });
  values = updateCorrectionSettings(values, { severity: 0.6 });
  values = updateCorrectionSettings(values, { color_type: 'protan' });
  assert.equal(values.severity, 0.4);
  values = updateCorrectionSettings(values, { severity: 0.2 });
  assert.deepEqual({ ...values.color_severities }, { protan: 0.2, deutan: 0.8, tritan: 0.6 });
  assert.equal(saved.severity, 0.4, 'draft updates must not mutate the saved profile');
  assert.equal(correctionSettingsChanged(values, saved), true);
  assert.equal(correctionSettingsChanged(values, structuredClone(values)), false);
  const disabled = updateCorrectionSettings(values, { color_type: 'normal' });
  assert.equal(calibration.serverCorrection(disabled).severity, 0);
  assert(Object.values(calibration.serverCorrection(disabled).color_severities).every((level) => level === 0));
  values = updateCorrectionSettings(disabled, { color_type: 'deutan' });
  assert.equal(values.severity, 0.8, 'the existing off control must retain the stored levels');
  values = updateCorrectionSettings(values, { severity: 0 });
  assert.deepEqual({ ...values.color_severities }, { protan: 0.2, deutan: 0, tritan: 0.6 });
});

test('clearing one color preserves the selected type and other saved levels without mutating the draft', () => {
  const { correctionSettings, clearColorSeverity } = correctionSettingsLib;
  const { DEFAULT_PROFILE } = load('types/profile.ts');
  const values = correctionSettings({ ...DEFAULT_PROFILE, calibration: {
    color_type: 'deutan', severity: 0.6, edge: 0.4,
    color_severities: { protan: 1, deutan: 0.6, tritan: 0.2 },
  } });
  const cleared = clearColorSeverity(values, 'protan');
  assert.equal(cleared.color_type, 'deutan');
  assert.equal(cleared.severity, 0.6);
  assert.deepEqual({ ...cleared.color_severities }, { protan: 0, deutan: 0.6, tritan: 0.2 });
  assert.equal(values.color_severities.protan, 1);
  const selectedCleared = clearColorSeverity(cleared, 'deutan');
  assert.equal(selectedCleared.color_type, 'deutan');
  assert.equal(selectedCleared.severity, 0);
  assert.equal(selectedCleared.color_severities.tritan, 0.2);
  const disabled = clearColorSeverity({ ...values, color_type: 'normal', severity: 0 }, 'protan');
  assert.equal(disabled.color_type, 'normal');
  assert.equal(disabled.severity, 0);
  assert.equal(disabled.color_severities.deutan, 0.6);
});

test('all color levels are converted and scaled even if the currently selected type is zero', () => {
  const profile = calibration.viewingFromProfile({
    ...load('types/profile.ts').DEFAULT_PROFILE,
    calibration: { color_type: 'deutan', severity: 0, edge: 0.4, color_severities: { protan: 0.6, deutan: 0, tritan: 0.8 } },
  });
  const server = calibration.serverCorrection(profile, 0.5);
  assert.equal(server.severity, 0);
  assert.equal(server.edge, 0.2);
  assert.deepEqual({ ...server.color_severities }, { protan: 0.3, deutan: 0, tritan: 0.4 });
  for (const colors of [{ protan: -0.1 }, { tritan: 1.1 }, { normal: 0 }, { deutan: NaN }, []]) {
    assert.equal(calibrationTypes.isCalibrationSettings({ color_type: 'protan', severity: 0.4, edge: 0, color_severities: colors }), false);
  }
});

test('artwork correction loads when another type is active and skips requests when all types are off', async () => {
  for (const enabled of [true, false]) {
    const timers = [];
    const calls = [];
    const { useCorrectedArtwork } = load('hooks/use-corrected-artwork.ts', {
      react: { useEffect: (effect) => effect(), useState: (initial) => [initial, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
      '@/lib/api': { ApiError: class extends Error {}, cachedCorrectedImage: () => undefined,
        subscribeCorrectionMode: () => () => {}, getCorrectionModeSnapshot: () => 'selective',
        getCorrectedImage: async (...args) => { calls.push(args); return 'corrected'; } },
      '@/lib/calibration': calibration,
      '@/hooks/use-profile': { useProfile: () => ({ loaded: true, error: false, reloadProfile: () => {} }) },
      '@/store/auth': { getAccessToken: () => 'account' },
    }, { setTimeout: (callback) => { timers.push(callback); return 1; } });
    const values = { ...calibration.DEFAULT_VIEWING, color_type: 'tritan', severity: 0,
      color_severities: { protan: enabled ? 0.6 : 0, deutan: 0, tritan: 0 }, revision: 'a'.repeat(64) };
    useCorrectedArtwork('sample', 'original.jpg', values);
    timers.forEach((callback) => callback());
    await tick();
    assert.equal(calls.length, enabled ? 1 : 0);
  }
});

test('MoMi and previously printed QR codes resolve to the same artwork', () => {
  const { parseArtworkQr } = load('lib/artwork-qr.ts');
  assert.equal(parseArtworkQr('momi://artwork/aic-05'), 'aic-05');
  assert.equal(parseArtworkQr('swaithon://artwork/aic-05'), 'aic-05');
  assert.equal(parseArtworkQr('aic-05'), 'aic-05');
  assert.equal(parseArtworkQr('momi://artwork/'), null);
});

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

test('history profile conversion preserves its color and edge values instead of current settings', () => {
  const result = calibration.viewingFromProfile({
    color_vision: 'protanopia', color_severity: 0.2,
    calibration: { color_type: 'deutan', severity: 0.6, edge: 0.4 },
    contrast: 0.8, brightness: -0.25, sharpen: 1.2,
  });
  assert.equal(result.color_type, 'deutan');
  assert.equal(result.severity, 0.6);
  assert.equal(result.edge, 0.4);
  assert.equal(result.brightness, -0.25);
  assert.equal(result.sharpness, 1.2);
});

test('legacy viewing settings migrate once and keep brightness and contrast units', async () => {
  const storage = new Map([['swaithon.viewing.v1', JSON.stringify({ completed: true, values: {
    color_type: 'tritan', severity: 0.6, edge: 0.2, contrast: 0.8, brightness: -0.25, sharpness: 1.4,
  } })]]);
  const { store, profiles, switchUser } = profileStore({ storage });
  await new Promise((resolve) => setImmediate(resolve));
  const state = store.getProfileSnapshot();
  assert.equal(state.error, false);
  assert.equal(state.saved, true);
  assert.equal(state.profile.calibration.color_type, 'tritan');
  assert.equal(state.profile.calibration.edge, 0.2);
  assert.equal(state.profile.contrast, 0.8);
  assert.equal(state.profile.brightness, -0.25);
  assert.equal(state.profile.sharpen, 1.4);
  assert.equal(profiles.get('user-1').color_vision, 'tritanopia');
  switchUser('user-2');
  await tick();
  assert.equal(store.getProfileSnapshot().saved, false);
  assert.equal(store.getProfileSnapshot().profile.calibration, undefined);
  assert.equal(profiles.has('user-2'), false);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const loginResult = {
  access_token: 'session-token', token_type: 'bearer', expires_in: 604800,
  user: { id: 'user-1', nickname: '관람객', email: 'viewer@example.com', created_at: '2026-11-11' },
};

function profileStore({ storage = new Map(), profiles = new Map(), failPut = false, failStorage = false, read, write } = {}) {
  const defaults = load('types/profile.ts');
  let userId = 'user-1';
  const authListeners = new Set();
  const writes = [];
  const store = load('store/profile.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getItem: async (key) => { if (failStorage) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem: async (key, value) => { storage.set(key, value); },
    } },
    '@/types/profile': defaults,
    '@/types/calibration': load('types/calibration.ts'),
    '@/lib/calibration': calibration,
    '@/store/auth': {
      getAccessToken: () => userId ? `token-${userId}` : null,
      getAuthSnapshot: () => ({ loaded: true, session: userId ? { user: { id: userId } } : null }),
      subscribeAuth: (listener) => { authListeners.add(listener); return () => authListeners.delete(listener); },
    },
    '@/lib/api': {
      getProfile: async () => read ? read(userId) : structuredClone(profiles.get(userId) ?? defaults.DEFAULT_PROFILE),
      putProfile: async (value) => {
        const owner = userId;
        if (write) await write(owner, value);
        if (failPut) throw new Error('DB write failed');
        writes.push({ userId: owner, profile: structuredClone(value) });
        profiles.set(owner, structuredClone(value));
        return structuredClone(value);
      },
    },
  });
  store.subscribeProfile(() => {});
  return { store, profiles, writes, switchUser: (id) => { userId = id; authListeners.forEach((listener) => listener()); } };
}

test('calibration is saved to the account DB before being used and untested filters reset to neutral', async () => {
  const { store, profiles, writes } = profileStore();
  await tick();
  await store.saveCalibration({ color_type: 'deutan', severity: 0.4, edge: 0.2, contrast: 1.2 });
  assert.equal(writes.length, 1);
  assert.deepEqual(profiles.get('user-1').calibration, { color_type: 'deutan', severity: 0.4, edge: 0.2 });
  assert.equal(store.getProfileSnapshot().profile.contrast, 1.2);
  assert.equal(store.getProfileSnapshot().profile.strength, 1);
  assert.equal(store.getProfileSnapshot().profile.brightness, 0);
  assert.equal(store.getProfileSnapshot().profile.sharpen, 0);
});

test('all color levels survive saving, reloading, unrelated settings, and recalibrating another type', async () => {
  const { store, profiles } = profileStore();
  await tick();
  await store.saveCalibration({ color_type: 'protan', severity: 0.4, edge: 0.2, contrast: 1.2 });
  const { correctionSettings, updateCorrectionSettings } = correctionSettingsLib;
  let values = correctionSettings(store.getProfileSnapshot().profile);
  values = updateCorrectionSettings(values, { color_type: 'deutan' });
  values = updateCorrectionSettings(values, { severity: 0.6 });
  values = updateCorrectionSettings(values, { color_type: 'tritan' });
  values = updateCorrectionSettings(values, { severity: 0.8 });
  await store.saveViewingSettings(values);
  await store.saveNarrationMode('facts');
  const restored = profileStore({ profiles });
  await tick();
  assert.deepEqual({ ...restored.store.getProfileSnapshot().profile.calibration.color_severities }, { protan: 0.4, deutan: 0.6, tritan: 0.8 });
  await restored.store.saveCalibration({ color_type: 'deutan', severity: 0.2, edge: 0.2, contrast: 1.2 });
  assert.deepEqual(profiles.get('user-1').calibration.color_severities, { protan: 0.4, deutan: 0.2, tritan: 0.8 });
});

test('cleared color stays off after saving and reloading while the other color remains applied', async () => {
  const { store, profiles } = profileStore();
  await tick();
  await store.saveCalibration({ color_type: 'protan', severity: 1, edge: 0.2, contrast: 1.2 });
  const { correctionSettings, updateCorrectionSettings, clearColorSeverity } = correctionSettingsLib;
  let values = correctionSettings(store.getProfileSnapshot().profile);
  values = updateCorrectionSettings(values, { color_type: 'deutan', severity: 0.6 });
  await store.saveViewingSettings(values);
  values = clearColorSeverity(correctionSettings(store.getProfileSnapshot().profile), 'protan');
  await store.saveViewingSettings(values);
  const restored = profileStore({ profiles });
  await tick();
  const settings = correctionSettings(restored.store.getProfileSnapshot().profile);
  assert.equal(settings.color_type, 'deutan');
  assert.equal(settings.severity, 0.6);
  assert.deepEqual({ ...settings.color_severities }, { protan: 0, deutan: 0.6, tritan: 0 });
  assert.deepEqual({ ...calibration.serverCorrection(calibration.viewingFromProfile(restored.store.getProfileSnapshot().profile)).color_severities },
    { protan: 0, deutan: 0.6, tritan: 0 });
});

test('a failed DB save never becomes a successful calibration in shared state', async () => {
  const { store, writes } = profileStore({ failPut: true });
  await tick();
  await assert.rejects(store.saveCalibration({ color_type: 'protan', severity: 0.4, edge: 0.2, contrast: 1.4 }), /DB write failed/);
  assert.equal(writes.length, 0);
  assert.equal(store.getProfileSnapshot().saved, false);
  assert.equal(store.getProfileSnapshot().profile.contrast, 1);
});

test('the DB wins over old device data and late account responses are ignored', async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const { DEFAULT_PROFILE } = load('types/profile.ts');
  const second = { ...DEFAULT_PROFILE, calibration: { color_type: 'tritan', severity: 0.2, edge: 0.4 }, contrast: 1.2 };
  const { store, switchUser, writes } = profileStore({
    storage: new Map([['swaithon:profile:v1', JSON.stringify({ ...DEFAULT_PROFILE, calibration: { color_type: 'deutan', severity: 1, edge: 1 } })]]),
    read: (id) => id === 'user-1' ? first : second,
  });
  switchUser('user-2');
  await tick();
  assert.equal(store.getProfileSnapshot().profile.calibration.color_type, 'tritan');
  finishFirst({ ...DEFAULT_PROFILE, calibration: { color_type: 'protan', severity: 1, edge: 1 } });
  await tick();
  assert.equal(store.getProfileSnapshot().profile.calibration.color_type, 'tritan');
  assert.equal(writes.length, 0);
  switchUser(null);
  assert.equal(store.getProfileSnapshot().profile.calibration, undefined);
  assert.equal(store.getProfileSnapshot().profile.contrast, 1);
});

test('a save queued under a different account cannot modify the next account', async () => {
  const { store, switchUser, writes } = profileStore();
  await tick();
  const saving = store.saveCalibration({ color_type: 'deutan', severity: 0.2, edge: 0.2, contrast: 1.2 });
  switchUser('user-2');
  await assert.rejects(saving, /로그인이 필요해요/);
  assert.equal(writes.length, 0);
});

test('saving a narration preference merges the latest DB calibration rather than a stale snapshot', async () => {
  const { DEFAULT_PROFILE } = load('types/profile.ts');
  const profiles = new Map([['user-1', { ...DEFAULT_PROFILE,
    calibration: { color_type: 'deutan', severity: 0.2, edge: 0.2 }, revision: 'old' }]]);
  const { store } = profileStore({ profiles });
  await tick();
  profiles.set('user-1', { ...DEFAULT_PROFILE,
    calibration: { color_type: 'deutan', severity: 0.8, edge: 0.4 }, revision: 'new' });
  await store.saveNarrationMode('facts');
  assert.equal(profiles.get('user-1').calibration.severity, 0.8);
  assert.equal(profiles.get('user-1').revision, 'new');
  assert.equal(profiles.get('user-1').narration_mode, 'facts');
});

test('a local migration-marker failure cannot replace a valid DB profile with defaults', async () => {
  const { DEFAULT_PROFILE } = load('types/profile.ts');
  const { store } = profileStore({ failStorage: true,
    profiles: new Map([['user-1', { ...DEFAULT_PROFILE, contrast: 1.4,
      calibration: { color_type: 'deutan', severity: 0.4, edge: 0.2 } }]]) });
  await tick();
  assert.equal(store.getProfileSnapshot().error, false);
  assert.equal(store.getProfileSnapshot().saved, true);
  assert.equal(store.getProfileSnapshot().profile.contrast, 1.4);
});

test('the next account can save without waiting for an old account request to finish', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const { store, switchUser, writes } = profileStore({ write: (owner) => owner === 'user-1' ? blocked : undefined });
  await tick();
  const oldSaving = store.saveNarrationMode('facts');
  await tick();
  switchUser('user-2');
  await tick();
  await store.saveCalibration({ color_type: 'tritan', severity: 0.2, edge: 0.2, contrast: 1.2 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].userId, 'user-2');
  release();
  await assert.rejects(oldSaving, /계정이 변경/);
  assert.equal(store.getProfileSnapshot().profile.calibration.color_type, 'tritan');
});

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/images/calibration/calibration.json'), 'utf8'));
test('each slider level selects its matching bundled color and edge preview, with a stable original', () => {
  const assetDir = path.join(__dirname, '../../assets/images/calibration');
  const assets = Object.fromEntries(fs.readdirSync(assetDir).filter((name) => name.endsWith('.jpg')).map((name) => [`./${name}`, name]));
  const { CALIBRATION } = load('../assets/images/calibration/index.ts', assets);
  const { correctionPreview } = load('lib/correction-settings.ts', { '@/assets/images/calibration': { CALIBRATION }, '@/types/calibration': calibrationTypes });
  for (const color_type of ['protan', 'deutan', 'tritan']) {
    for (const [index, severity] of manifest.preview.levels.entries()) {
      const values = { color_type, severity, edge: severity, contrast: 1, brightness: 0, sharpen: 0 };
      const preview = correctionPreview(values, 'color', false);
      assert.equal(preview.plate, manifest.preview[color_type].plate[index]);
      assert.equal(preview.artwork, manifest.preview[color_type].artwork[index]);
      assert.equal(correctionPreview(values, 'color', true).artwork, manifest.preview[color_type].artwork[0]);
      assert.equal(correctionPreview(values, 'edge', false).artwork, manifest.edge.files[index]);
      assert.equal(correctionPreview(values, 'edge', true).artwork, manifest.edge.files[0]);
    }
    for (const kind of ['plate', 'artwork']) {
      const images = manifest.preview[color_type][kind].map((name) => fs.readFileSync(path.join(assetDir, name)).toString('base64'));
      assert.equal(new Set(images).size, 6, `${color_type} ${kind}: all six levels must differ`);
    }
  }
});
const flow = load('lib/calibration-flow.ts', { '@/assets/images/calibration': { CALIBRATION: manifest } });

test('single-photo correction preview covers every color/edge combination with one stable original and no server request', () => {
  const indexPath = path.join(__dirname, '../../assets/images/correction-preview/index.ts');
  const js = ts.transpileModule(fs.readFileSync(indexPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require(relative) {
    const asset = path.resolve(path.dirname(indexPath), relative);
    assert(fs.existsSync(asset), `Missing combined preview: ${relative}`);
    return asset;
  } });
  const { combinedCorrectionPreview } = load('lib/combined-correction-preview.ts', { '@/assets/images/correction-preview': exports });
  const original = combinedCorrectionPreview({ color_type: 'normal', severity: 0, edge: 0 }, true);
  const unique = new Set();
  for (const color_type of ['normal', 'protan', 'deutan', 'tritan']) {
    for (let severity = 0; severity <= 5; severity++) {
      for (let edge = 0; edge <= 5; edge++) {
        const values = { color_type, severity: severity / 5, edge: edge / 5, contrast: 1.4, brightness: 0.3, sharpen: 1 };
        const source = combinedCorrectionPreview(values);
        unique.add(source);
        assert.equal(combinedCorrectionPreview(values, true), original);
        assert.equal(combinedCorrectionPreview({ ...values, contrast: 0.5, brightness: -0.5, sharpen: 0 }), source, 'Skia parameters must not be baked into the image');
        if (color_type === 'normal' || severity === 0) assert.equal(source, combinedCorrectionPreview({ ...values, color_type: 'normal', severity: 0 }));
        else assert(source.endsWith(`farmhouse-${color_type}-${severity * 20}-edge-${edge * 20}.jpg`));
      }
    }
  }
  assert.equal(unique.size, 96);
});

test('failed calibration steps never auto-select maximum correction', () => {
  let state = flow.advanceCalibration({ ...flow.initialCalibration(), phase: 'manual' }, { type: 'choose', value: 'deutan' });
  while (state.phase === 'color') {
    const plate = manifest.color.deutan.plates[state.index];
    state = flow.advanceCalibration(state, { type: 'answer', value: plate.choices.find((choice) => choice !== plate.answer) });
  }
  while (state.phase !== 'complete') state = flow.advanceCalibration(state, { type: 'answer', value: 'not-visible' });
  assert.equal(state.result.severity, 0);
  assert.equal(state.result.edge, 0);
  assert.equal(state.result.contrast, 1);
});

test('the first successful color, edge and contrast levels are preserved exactly', () => {
  let state = flow.advanceCalibration({ ...flow.initialCalibration(), phase: 'manual' }, { type: 'choose', value: 'deutan' });
  state = flow.advanceCalibration(state, { type: 'answer', value: manifest.screening.not_visible });
  state = flow.advanceCalibration(state, { type: 'answer', value: manifest.color.deutan.plates[state.index].answer });
  state = flow.advanceCalibration(state, { type: 'answer', value: 'not-visible' });
  state = flow.advanceCalibration(state, { type: 'answer', value: 'not-visible' });
  state = flow.advanceCalibration(state, { type: 'answer', value: 'visible' });
  state = flow.advanceCalibration(state, { type: 'answer', value: 'not-visible' });
  state = flow.advanceCalibration(state, { type: 'answer', value: 'visible' });
  assert.equal(state.phase, 'complete');
  assert.equal(state.result.severity, 0.4);
  assert.equal(state.result.edge, 0.4);
  assert.equal(state.result.contrast, 1.2);
});

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

test('a stale 401 cannot clear a new session even when credential writes overlap', async () => {
  const { store, storage } = authStore();
  await store.saveSession(loginResult);
  const clearing = store.clearSession('session-token');
  const saving = store.saveSession({ ...loginResult, access_token: 'new-session-token' });
  const lateClear = store.clearSession('session-token');
  await Promise.all([clearing, saving, lateClear]);
  assert.equal(store.getAccessToken(), 'new-session-token');
  assert.equal(JSON.parse(storage.raw).token, 'new-session-token');
});

function apiClient(respond, token = 'saved-token', mode = 'selective') {
  const calls = [];
  const configCalls = [];
  let cleared = false;
  const api = load('lib/api.ts', {
    'expo-file-system': { File: class {} }, 'react-native': { Platform: { OS: 'ios' } },
    'expo/fetch': { fetch: async (url, init) => {
      if (url.endsWith('/correction/config')) {
        configCalls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ mode: typeof mode === 'function' ? mode() : mode }) };
      }
      calls.push({ url, init });
      const response = await respond(url, init);
      if (response.headers && !response.headers.has('X-Correction-Mode')) response.headers.set('X-Correction-Mode', 'selective');
      return response;
    } },
    '@/store/auth': { getAccessToken: () => typeof token === 'function' ? token() : token, clearSession: async () => { cleared = true; } },
    '@/lib/calibration': calibration,
  });
  return { api, calls, configCalls, cleared: () => cleared };
}

test('home artwork pages request 20 at a time with correct offsets while other callers retain the 100-item default', async () => {
  const works = Array.from({ length: 45 }, (_, index) => ({ id: `work-${index + 1}`, number: String(index + 1), museum_id: 'museum one' }));
  const { api, calls } = apiClient((url) => {
    const params = new URL(url).searchParams;
    const offset = Number(params.get('offset'));
    const limit = Number(params.get('limit'));
    return { ok: true, status: 200, json: async () => ({ items: works.slice(offset, offset + limit).reverse(), total: works.length }) };
  });
  const pages = await Promise.all([0, 20, 40].map((offset) => api.getMuseumArtworkPage('museum one', offset, 20)));
  assert.deepEqual(pages.map((page) => page.items.length), [20, 20, 5]);
  assert.equal(new Set(pages.flatMap((page) => page.items.map((work) => work.id))).size, 45);
  assert.deepEqual(pages.flatMap((page) => page.items.map((work) => Number(work.number))), Array.from({ length: 45 }, (_, index) => index + 1));
  calls.forEach(({ url }, index) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('limit'), '20');
    assert.equal(params.get('offset'), String(index * 20));
    assert.equal(params.get('museum_id'), 'museum one');
  });
  await api.getMuseumArtworks('museum one');
  assert.equal(new URL(calls.at(-1).url).searchParams.get('limit'), '100');
});

test('login sends credentials without an existing bearer token', async () => {
  const { api, calls } = apiClient(() => ({ ok: true, status: 200, json: async () => loginResult }));
  await api.login('  viewer@example.com  ', 'example-password');
  assert.equal(calls[0].init.headers.get('Authorization'), null);
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'viewer@example.com', password: 'example-password' });
});

test('correction requests contain only an artwork and a bounded ratio, and caches are account scoped', async () => {
  let token = 'first-account';
  const revision = 'a'.repeat(64);
  const { api, calls } = apiClient(() => ({ ok: true, status: 200,
    headers: new Headers({ 'X-Correction-Profile-Revision': revision }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }), () => token);
  const profile = { ...calibration.DEFAULT_VIEWING, color_type: 'deutan', severity: 0.2, edge: 0.4, revision };
  await api.getCorrectedImage('sample', profile, 5);
  assert.equal(calls[0].init.body.has('profile'), false);
  assert.equal(calls[0].init.body.get('artwork_id'), 'sample');
  assert.equal(calls[0].init.body.get('strength'), '1');
  assert.equal(calls[0].init.body.get('profile_revision'), revision);
  await api.getCorrectedImage('sample', profile, 1);
  assert.equal(calls.length, 1);
  token = 'second-account';
  await api.getCorrectedImage('sample', profile, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer second-account');
  token = null;
  await assert.rejects(api.getCorrectedImage('sample', profile), /로그인이 필요해요/);
});

test('a correction made from a different DB version is never returned or cached', async () => {
  let attempts = 0;
  const revision = 'a'.repeat(64);
  const { api, calls } = apiClient(() => ({ ok: true, status: 200,
    headers: new Headers({ 'X-Correction-Profile-Revision': ++attempts === 1 ? 'b'.repeat(64) : revision }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  const profile = { ...calibration.DEFAULT_VIEWING, edge: 0.2, revision };
  await assert.rejects(api.getCorrectedImage('sample', profile), /보정값이 변경/);
  await api.getCorrectedImage('sample', profile);
  assert.equal(calls.length, 2);
});

test('server mode is checked before cache reuse and mode changes regenerate images', async () => {
  let mode = 'selective';
  const revision = 'a'.repeat(64);
  const { api, calls, configCalls } = apiClient(() => ({ ok: true, status: 200,
    headers: new Headers({ 'X-Correction-Profile-Revision': revision, 'X-Correction-Mode': mode }),
    arrayBuffer: async () => new Uint8Array([mode === 'cluster' ? 9 : 1]).buffer }), 'saved-token', () => mode);
  const profile = { ...calibration.DEFAULT_VIEWING, color_type: 'deutan', severity: .6, revision };
  const selective = await api.getCorrectedImage('sample', profile);
  assert.equal(await api.getCorrectedImage('sample', profile), selective);
  assert.equal(calls.length, 1);
  mode = 'cluster';
  const cluster = await api.getCorrectedImage('sample', profile);
  assert.notEqual(cluster, selective);
  assert.equal(calls.length, 2);
  assert.equal(api.cachedCorrectedImage('sample', profile), cluster);
  assert.equal(api.getCorrectionModeSnapshot(), 'cluster');
  assert.equal(configCalls.length, 3);
  mode = 'selective';
  assert.equal(await api.getCorrectedImage('sample', profile), selective);
  assert.equal(calls.length, 3);
});

test('an image response for the wrong server mode is never cached', async () => {
  const revision = 'a'.repeat(64);
  const { api, calls } = apiClient(() => ({ ok: true, status: 200,
    headers: new Headers({ 'X-Correction-Profile-Revision': revision, 'X-Correction-Mode': 'selective' }),
    arrayBuffer: async () => new Uint8Array([1]).buffer }), 'saved-token', 'cluster');
  const profile = { ...calibration.DEFAULT_VIEWING, edge: .2, revision };
  await assert.rejects(api.getCorrectedImage('sample', profile), /모드가 변경/);
  await assert.rejects(api.getCorrectedImage('sample', profile), /모드가 변경/);
  assert.equal(calls.length, 2);
  assert.equal(api.cachedCorrectedImage('sample', profile), undefined);
});

test('mode changes notify image hooks and invalidate a response still in flight', async () => {
  let mode = 'selective';
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const revision = 'a'.repeat(64);
  const { api } = apiClient((url, init) => init.body.get('artwork_id') === 'old'
    ? blocked : { ok: true, status: 200, headers: new Headers({ 'X-Correction-Profile-Revision': revision, 'X-Correction-Mode': mode }),
      arrayBuffer: async () => new Uint8Array([9]).buffer }, 'saved-token', () => mode);
  const observed = [];
  const unsubscribe = api.subscribeCorrectionMode(() => observed.push(api.getCorrectionModeSnapshot()));
  const profile = { ...calibration.DEFAULT_VIEWING, edge: .2, revision };
  const pending = api.getCorrectedImage('old', profile);
  await tick();
  mode = 'cluster';
  await api.getCorrectedImage('new', profile);
  release({ ok: true, status: 200, headers: new Headers({ 'X-Correction-Profile-Revision': revision, 'X-Correction-Mode': 'selective' }),
    arrayBuffer: async () => new Uint8Array([1]).buffer });
  await assert.rejects(pending, /모드가 변경/);
  assert.deepEqual(observed, ['selective', 'cluster']);
  assert.equal(api.cachedCorrectedImage('old', profile), undefined);
  unsubscribe();
});

test('a correction in flight during a profile save cannot poison the old-strength cache', async () => {
  const revision = 'a'.repeat(64);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const { api } = apiClient((url) => url.endsWith('/me/profile')
    ? { ok: true, status: 200, json: async () => ({ revision: 'b'.repeat(64) }) }
    : blocked);
  const request = api.getCorrectedImage('sample', { ...calibration.DEFAULT_VIEWING, edge: 0.2, revision });
  await api.putProfile({});
  release({ ok: true, status: 200, headers: new Headers({ 'X-Correction-Profile-Revision': revision }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  await assert.rejects(request, /보정값이 변경/);
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
  await assert.rejects(api.generateNarration('art'), /해설을 준비하지 못했어요/);
  const [a, b] = await Promise.all([api.generateNarration('art'), api.generateNarration('art')]);
  assert.equal(a.review_status, 'unreviewed');
  assert.equal(a, b);
  await api.generateNarration('art');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'POST');
});

test('clear screening results skip the picker; only ambiguous results ask to compare pictures', () => {
  const plates = manifest.screening.plates;
  const run = (wrongTypes) => plates.reduce((state, plate) => flow.advanceCalibration(state, {
    type: 'answer', value: wrongTypes.includes(plate.color_type) ? manifest.screening.not_visible : plate.answer,
  }), flow.initialCalibration());
  let state = run([]);
  assert.equal(state.phase, 'edge');
  assert.equal(state.result.color_type, 'normal');
  state = run(['protan']);
  assert.equal(state.phase, 'color');
  assert.equal(state.result.color_type, 'protan');
  assert.equal(state.answers.length, plates.length);
  state = run(['protan', 'deutan', 'tritan']);
  assert.equal(state.phase, 'manual');
});
