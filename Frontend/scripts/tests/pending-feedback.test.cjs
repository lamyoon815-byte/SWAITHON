const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const file = path.join(__dirname, '../../src/lib/pending-feedback.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Set });
  return module.exports;
}

test('home takes the finished artwork once', () => {
  const { markFeedbackPending, takePendingFeedback } = load();
  assert.equal(takePendingFeedback(), null);
  markFeedbackPending({ artworkId: 'a', title: '수련' });
  assert.deepEqual({ ...takePendingFeedback() }, { artworkId: 'a', title: '수련' });
  assert.equal(takePendingFeedback(), null);
});

test('an artwork already asked about is not asked again in this session', () => {
  const { markFeedbackPending, takePendingFeedback } = load();
  markFeedbackPending({ artworkId: 'a', title: '수련' });
  takePendingFeedback();
  markFeedbackPending({ artworkId: 'a', title: '수련' });
  assert.equal(takePendingFeedback(), null);
  markFeedbackPending({ artworkId: 'b', title: '침실' });
  assert.equal(takePendingFeedback().artworkId, 'b');
});

test('the latest finished artwork wins before returning home', () => {
  const { markFeedbackPending, takePendingFeedback } = load();
  markFeedbackPending({ artworkId: 'a', title: '수련' });
  markFeedbackPending({ artworkId: 'b', title: '침실' });
  assert.equal(takePendingFeedback().artworkId, 'b');
});


test('unregistered sessions are asked once without consuming registered feedback', () => {
  const { markFeedbackPending, takePendingFeedback } = load();
  markFeedbackPending({ artworkId: 'a', title: '수련' });
  assert.equal(takePendingFeedback('analysis'), null);
  assert.equal(takePendingFeedback().artworkId, 'a');
  markFeedbackPending({ artworkId: null, analysisId: 'capture-1', title: '촬영한 작품' });
  assert.equal(takePendingFeedback('analysis').analysisId, 'capture-1');
  markFeedbackPending({ artworkId: null, analysisId: 'capture-1', title: '촬영한 작품' });
  assert.equal(takePendingFeedback(), null);
  markFeedbackPending({ artworkId: null, analysisId: 'capture-2', title: '촬영한 작품' });
  assert.equal(takePendingFeedback().analysisId, 'capture-2');
});
