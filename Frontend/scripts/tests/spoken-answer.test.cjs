// node scripts/tests/spoken-answer.test.cjs  (TS 소스를 직접 불러오지 않고 같은 규칙을 esbuild 없이 확인하기 위해 transpile)
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/lib/spoken-answer.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const mod = { exports: {} };
new Function('module', 'exports', outputText)(mod, mod.exports);
const { matchSpokenChoice } = mod.exports;

const choices = ['97', '45', '71', '숫자가 안 보여요'];
assert.strictEqual(matchSpokenChoice('45', choices), '45');
assert.strictEqual(matchSpokenChoice('45번이요.', choices), '45');
assert.strictEqual(matchSpokenChoice('사십오', choices), '45');
assert.strictEqual(matchSpokenChoice('사십 오요', choices), '45');
assert.strictEqual(matchSpokenChoice('칠십일', choices), '71');
assert.strictEqual(matchSpokenChoice('구십칠이 보여요', choices), '97');
assert.strictEqual(matchSpokenChoice('숫자가 안 보여요', choices), '숫자가 안 보여요');
assert.strictEqual(matchSpokenChoice('잘 모르겠어요', choices), '숫자가 안 보여요');
assert.strictEqual(matchSpokenChoice('29', choices), null);
assert.strictEqual(matchSpokenChoice('', choices), null);
console.log('spoken-answer: ok');
