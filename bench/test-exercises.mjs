// Replays every exercise's reference solution through the checker, then auto-solves every exercise using only
// Unstuck level-3 hints. Exit 1 on any failure. Run: node bench/test-exercises.mjs
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const L = require('../logic-core.js'), X = require('../exercises.js'), LS = require('../lab-session.js');
let fail = 0, n = 0; const bad = (m) => { fail++; console.log('  ✗ ' + m); };
for (const t of X.TRACKS) {
  for (const ex of X[t.id]) {
    n++;
    // 1) reference solution
    let s = LS.create(t.id, ex);
    let ref = ex.ref;
    if (t.id === 'cnf') ref = L.toCNF(L.parse(ex.start)).trace.map((st) => [L.show(st.f), st.rule]);
    if (t.id === 'resolution' && !ex.given) ex.clauses.forEach((c) => { const r = s.add({ f: c, rule: 'clause' }); if (!r.ok) bad(`${ex.id} setup clause ${c}: ${r.msg}`); });
    for (const st of ref) {
      let r;
      if (t.id === 'patterns') r = s.add({ f: st[0], rule: st[1], cites: st[2] });
      else if (t.id === 'cnf') r = s.add({ f: st[0], rule: st[1] });
      else if (t.id === 'resolution') { const A = s.all(); const a = A[st[0] - 1], b = A[st[1] - 1]; const rs = L.resolvents(a.c, b.c).filter((x) => !L.isTaut(x.c)); r = s.add({ f: rs.length ? L.clauseText(rs[0].c).replace('□', '⊥') : '⊥', rule: 'resolve', cites: st }); }
      else if (t.id === 'fc') r = s.add({ ruleNo: st, head: L.parseDefinite(ex.rules[st - 1]).head });
      else if (t.id === 'bc') r = s.add({ goal: st[0], ruleNo: st[1] });
      if (!r.ok) bad(`${ex.id} ref step ${JSON.stringify(st)}: ${r.verdict} — ${r.msg}`);
      else if (!['correct', 'detour'].includes(r.verdict)) console.log(`  · ${ex.id} ref step ${JSON.stringify(st).slice(0, 60)} accepted as ${r.verdict}: ${r.msg}`);
    }
    if (!s.solved) bad(`${ex.id}: reference solution does not reach the goal`);
    // 2) auto-solve with level-3 hints only
    s = LS.create(t.id, ex); let guard = 0;
    while (!s.solved && guard++ < 40) {
      const h = s.hint(3); const ln = h.line;
      if (!ln) { bad(`${ex.id}: hint gave no line at step ${guard}: ${h.text}`); break; }
      let r;
      if (t.id === 'fc') r = s.add({ ruleNo: ln.ruleNo, head: ln.head });
      else if (t.id === 'bc') r = s.add({ goal: ln.goal, ruleNo: ln.ruleNo });
      else r = s.add({ f: ln.f, rule: ln.rule, cites: ln.cites });
      if (!r.ok) { bad(`${ex.id}: hinted step rejected: ${h.text} → ${r.msg}`); break; }
    }
    if (!s.solved) bad(`${ex.id}: hints did not solve it`);
    else console.log(`ok ${t.id}/${ex.id}  ref ${ref.length} steps · hints ${guard} steps`);
  }
}
console.log(fail ? `\n${fail} FAILURE(S) over ${n} exercises` : `\nALL ${n} exercises pass (reference + hint auto-solve)`);
process.exit(fail ? 1 : 0);
