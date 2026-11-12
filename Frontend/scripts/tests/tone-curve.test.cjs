// node --test scripts/tests/tone-curve.test.cjs  (대비 곡선: 어두운 그림이 검게 뭉개지지 않는지)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../../src/lib/tone-curve.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Math, Number, Array, Float32Array, console,
  require: () => ({ Skia: {}, AlphaType: {}, ColorType: {} }) });
const T = loaded.exports;

// 어두운 그림의 밝기 분포: 대부분 0.03~0.3, 밝은 부분 조금
const dark = Array.from({ length: 32 }, (_, i) => (i < 10 ? 100 : i === 22 ? 30 : 0));
const mean = (hist, f = (y) => y) => hist.reduce((s, c, i) => s + c * f((i + 0.5) / hist.length), 0) / hist.reduce((s, c) => s + c, 0);

test('곡선은 검정·흰색을 그대로 두고 밝기 순서를 뒤집지 않는다', () => {
  for (const c of [0.5, 0.8, 1.4, 2]) for (const mid of [0.2, 0.5, 0.7]) {
    assert.ok(Math.abs(T.toneCurve(0, c, mid)) < 1e-4);
    assert.ok(Math.abs(T.toneCurve(1, c, mid) - 1) < 1e-4);
    let previous = -1;
    for (let y = 0; y <= 1.0001; y += 0.01) {
      const v = T.toneCurve(y, c, mid);
      assert.ok(v >= previous - 1e-6);
      previous = v;
    }
  }
});

test('대비를 바꿔도 그림의 평균 밝기는 그대로다', () => {
  for (const c of [0.6, 1.4, 2]) {
    const mid = T.toneMid(dark, c);
    assert.ok(Math.abs(mean(dark, (y) => T.toneCurve(y, c, mid)) - mean(dark)) < 0.005, `c=${c}`);
  }
});

test('어두운 그림은 곡선 중심이 0.5보다 낮다 (예전에는 늘 0.5)', () => {
  assert.ok(T.toneMid(dark, 1.6) < 0.5);
  const bright = [...dark].reverse();
  assert.ok(T.toneMid(bright, 1.6) > 0.5);
});

test('중심에서의 기울기가 대비 값이다', () => {
  const mid = 0.3;
  const gain = T.sigmoidGain(2, mid);
  const slope = (T.toneCurve(mid + 1e-4, 2, mid) - T.toneCurve(mid - 1e-4, 2, mid)) / 2e-4;
  assert.ok(Math.abs(slope - 2) < 0.01, `slope=${slope} gain=${gain}`);
});

test('셰이더 값: 대비 1이거나 적용 비율 0이면 아무것도 바꾸지 않는다', () => {
  assert.equal(T.toneUniforms(1, 0, 1, dark).mode, 0);
  assert.equal(T.toneUniforms(2, 0.1, 0, dark).mode, 0);
  assert.equal(T.toneUniforms(2, 0.1, 0, dark).brightness, 0);
  const up = T.toneUniforms(2, 0, 1, dark);
  assert.equal(up.mode, 1);
  assert.ok(up.mid < 0.5 && up.low < up.high);
  assert.equal(T.toneUniforms(0.5, 0, 1, dark).mode, -1);
  assert.equal(T.toneUniforms(2, 0, 1, null).mid, 0.5); // 히스토그램을 못 만들면 0.5
});
