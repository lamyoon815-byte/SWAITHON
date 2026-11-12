// node --test scripts/tests/color-correction.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const CanvasKitInit = require('canvaskit-wasm');
const matrices = require('../../src/lib/color-correction-matrices.json');

const moduleUnderTest = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../../src/lib/color-correction.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: moduleUnderTest, exports: moduleUnderTest.exports,
  require(name) {
    if (name === './color-correction-matrices.json') return matrices;
    if (name === '@shopify/react-native-skia') return { Skia: { RuntimeEffect: {} } };
    throw new Error(`Unexpected import: ${name}`);
  },
});
const { COLOR_CORRECTION_SHADER, colorCorrectionUniforms } = moduleUnderTest.exports;

test('the preview shader compiles and matches combined server output, including zero/off stages', async () => {
  const kit = await CanvasKitInit({ locateFile: (file) => path.join(path.dirname(require.resolve('canvaskit-wasm')), file) });
  let error;
  const effect = kit.RuntimeEffect.Make(COLOR_CORRECTION_SHADER, (message) => { error = message; });
  assert(effect, error);
  const surface = kit.MakeSurface(1, 1);
  assert(surface);
  const input = kit.Shader.MakeColor(kit.Color4f(0.3, 0.4, 0.2, 1), kit.ColorSpace.SRGB);
  const paint = new kit.Paint();
  try {
    // Reference pixels from Backend.ai.correction.correct_array on RGB [0.3, 0.4, 0.2].
    const cases = [
      [{ protan: 0.4, deutan: 0.6, tritan: 0.8 }, [0.101495, 0.375721, 0]],
      [{ protan: 0.4, deutan: 0, tritan: 0.8 }, [0.062239, 0.400315, 0.07315]],
      [{ protan: 0, deutan: 0.6, tritan: 0 }, [0.300043, 0.374968, 0]],
      [{ protan: 0, deutan: 0, tritan: 0 }, [0.3, 0.4, 0.2]],
    ];
    const pixels = [];
    for (const [levels, expected] of cases) {
      const values = colorCorrectionUniforms(levels);
      const uniforms = new Float32Array(effect.getUniformFloatCount());
      for (let i = 0; i < effect.getUniformCount(); i++) {
        uniforms.set(values[effect.getUniformName(i)], effect.getUniform(i).slot);
      }
      const shader = effect.makeShaderWithChildren(uniforms, [input]);
      paint.setShader(shader);
      surface.getCanvas().drawPaint(paint);
      const result = surface.getCanvas().readPixels(0, 0, {
        width: 1, height: 1, colorType: kit.ColorType.RGBA_8888,
        alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB,
      });
      assert(result);
      for (let i = 0; i < 3; i++) assert(Math.abs(result[i] / 255 - expected[i]) < 0.01, `${JSON.stringify(levels)}, channel ${i}: ${result[i] / 255} vs ${expected[i]}`);
      pixels.push([...result]);
      shader.delete();
    }
    assert.notDeepEqual(pixels[0], pixels[1], 'disabling deutan must leave the other two effects visible');
    assert.notDeepEqual(pixels[0], pixels[2], 'combined output must differ from a single correction');
  } finally {
    paint.delete(); input.delete(); surface.delete(); effect.delete();
  }
});
