// Attaches the SwiftF0 model runner (onnxruntime-web, wasm backend: the same runtime a browser would use) to the registered f0/swiftf0 engine, in Node.
//   const { attachSwiftF0 } = require('./lib/swiftf0-node.js'); const where = attachSwiftF0(lib);   // -> { ort, model } paths, or null when they are not found
// Where it looks (nothing is vendored in the repo yet; the owner has not approved SwiftF0):
//   onnxruntime-web:  $ORT_WEB, else tools/node_modules/onnxruntime-web
//   model.onnx:       $SWIFTF0_MODEL, else vendor/swiftf0/model.onnx
const fs = require('fs'), path = require('path');
function attachSwiftF0(lib) {
  const root = lib.root, ortDir = process.env.ORT_WEB || path.join(root, 'tools', 'node_modules', 'onnxruntime-web'), modelFile = process.env.SWIFTF0_MODEL || path.join(root, 'vendor', 'swiftf0', 'model.onnx');
  if (!fs.existsSync(path.join(ortDir, 'package.json')) || !fs.existsSync(modelFile)) return null;
  let ort = null, session = null;
  lib.extendEngine('f0', 'swiftf0', {
    async infer(audio, fmin, fmax) {
      if (!session) { ort = require(ortDir); session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(modelFile)), { executionProviders: ['wasm'] }); }
      const sc = v => new ort.Tensor('float32', new Float32Array([v]), []);
      const r = await session.run({ audio: new ort.Tensor('float32', Float32Array.from(audio), [1, audio.length]), fmin: sc(fmin), fmax: sc(fmax) });
      return { pitch: r.pitch.data, confidence: r.confidence.data };
    },
    release() { session = null; },
  });
  return { ort: ortDir, model: modelFile, modelBytes: fs.statSync(modelFile).size };
}
module.exports = { attachSwiftF0 };
