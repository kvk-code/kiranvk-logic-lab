import fs from 'fs'; import { Ink, loadLocal } from './harness.mjs';
loadLocal(process.env.MODEL_DIR);
const cases = JSON.parse(fs.readFileSync('cases.json')); const norm = (s) => s.replace(/\s+/g, '').replace(/,/g, '');
let ok = 0, okNoLex = 0, tokErr = 0, tokTot = 0, ms = 0; const bad = [];
function ed(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
for (const c of cases) {
  const t0 = performance.now(); const r = Ink.recognise(c.strokes, c.lexicon, true); ms += performance.now() - t0;
  const r2 = Ink.recognise(c.strokes, [], true);
  const a = [...norm(r.text)], b = [...norm(c.truth)]; tokErr += ed(a, b); tokTot += b.length;
  if (norm(r.text) === norm(c.truth)) ok++; else bad.push(c.truth + '  →  ' + r.text);
  if (norm(r2.text) === norm(c.truth)) okNoLex++;
}
console.log(`lines exact (with board symbols): ${ok}/${cases.length} = ${(100 * ok / cases.length).toFixed(1)}%`);
console.log(`lines exact (no lexicon): ${okNoLex}/${cases.length} = ${(100 * okNoLex / cases.length).toFixed(1)}%`);
console.log(`symbol error rate: ${(100 * tokErr / tokTot).toFixed(2)}%   avg ${(ms / cases.length).toFixed(0)} ms/line (node, cold cache per line)`);
console.log(bad.slice(0, 25).join('\n'));
