// Node harness: loads ink.js with a canvas polyfill + local model files.
import fs from 'fs'; import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class { constructor(w, h) { return createCanvas(w, h); } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const src = fs.readFileSync(process.env.INK_JS, 'utf8'); (0, eval)(src);
export const Ink = globalThis.LogicInk;
export function loadLocal(dir) {
  const meta = JSON.parse(fs.readFileSync(dir + '/ink-model.json')); const buf = new Int8Array(fs.readFileSync(dir + '/ink-model.bin'));
  const T = {}; let o = 0; for (const t of meta.tensors) { const n = t.shape.reduce((a, b) => a * b, 1); const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = buf[o + i] * t.scale; T[t.name] = f; o += n; }
  Ink._setModel({ classes: meta.classes, T, meta });
}
