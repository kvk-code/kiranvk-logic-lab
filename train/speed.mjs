import fs from 'fs'; import { Ink, loadLocal } from './harness.mjs'; loadLocal(process.env.MODEL_DIR);
const c = JSON.parse(fs.readFileSync('cases.json'))[15]; const S = c.strokes;
// simulate live writing: recognise after every stroke
let t0 = performance.now(), worst = 0;
for (let k = 1; k <= S.length; k++) { const a = performance.now(); Ink.recognise(S.slice(0, k), c.lexicon, false); worst = Math.max(worst, performance.now() - a); }
console.log('strokes', S.length, 'total', (performance.now() - t0).toFixed(0), 'ms, worst per stroke', worst.toFixed(0), 'ms');
let a = performance.now(); const r = Ink.recognise(S, c.lexicon, true); console.log('final warm', (performance.now() - a).toFixed(0), 'ms', r.text);
