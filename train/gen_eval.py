# Synthetic-but-realistic test lines: letters/digits/brackets/commas are REAL held-out handwriting (MathWriting valid+test
# writers, never seen in training); logic operators come from held-out MW glyphs when present, else from a jittered
# stroke generator. Laid out on a line with random sizes, baseline wobble and gaps.
import pickle,random,json,math,collections
random.seed(7)
pool=collections.defaultdict(list)
for sp in ('valid','test'):
    for t,S,fn in pickle.load(open(f'mined_{sp}.pkl','rb')): pool[t].append(S)
print({k:len(v) for k,v in pool.items() if k in ('(',')',',','P','Q','R','A','B','C','and','or','not','imp','to','iff')})
def J(p,s=0.06): return [p[0]+random.gauss(0,s),p[1]+random.gauss(0,s)]
def line(a,b,n=12): return [J([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n],0.015) for i in range(n+1)]
def gen_op(op):
    r=lambda:random.uniform(-.08,.08)
    if op=='and': return [line([0,1+r()],[0.5+r(),0])+line([0.5,0],[1+r(),1+r()])[1:]]
    if op=='or': return [line([0,0+r()],[0.5+r(),1])+line([0.5,1],[1+r(),0+r()])[1:]]
    if op=='not': return [line([0,0.3+r()],[1+r(),0.3+r()])+line([1,0.3],[1+r(),0.75+r()])[1:]]
    if op=='imp':
        L=1.4+r(); s=[line([0,0.35+r()],[L,0.35+r()]),line([0,0.65+r()],[L,0.65+r()])]
        head=line([L-0.35,0.05+r()],[L+0.15,0.5])+line([L+0.15,0.5],[L-0.35,0.95+r()])[1:]
        return s+[head] if random.random()<.8 else [s[0]+[]]+[s[1]]+[head]
    if op=='to': L=1.4+r(); return [line([0,0.5+r()],[L,0.5+r()]),line([L-0.35,0.2],[L+0.1,0.5])+line([L+0.1,0.5],[L-0.35,0.8])[1:]]
    if op=='iff':
        L=1.6+r(); s=[line([0.1,0.35+r()],[L-0.1,0.35+r()]),line([0.1,0.65+r()],[L-0.1,0.65+r()])]
        h1=line([0.4,0.05],[0,0.5])+line([0,0.5],[0.4,0.95])[1:]; h2=line([L-0.4,0.05],[L,0.5])+line([L,0.5],[L-0.4,0.95])[1:]
        return s+[h1,h2]
def glyph(t):
    if t in pool and (t not in ('and','or','not','imp','to','iff') or random.random()<0.3): return random.choice(pool[t])
    return [[[x*30,y*30] for x,y in s] for s in gen_op(t)]
SYM={'∧':'and','∨':'or','¬':'not','⇒':'imp','⇔':'iff'}
def layout(tokens):
    out=[];x=0
    for t in tokens:
        S=glyph(t); pts=[p for s in S for p in s]; x0=min(p[0] for p in pts);x1=max(p[0] for p in pts);y0=min(p[1] for p in pts);y1=max(p[1] for p in pts)
        h=max(y1-y0,1e-3); w=max(x1-x0,1e-3)
        H={'(':58,')':58,',':14,'not':16,'and':26,'or':26,'imp':22,'to':18,'iff':22}.get(t, 42 if t.isupper() or t.isdigit() else 30)
        H*=random.uniform(.85,1.15); sc=H/h
        if t in('not','imp','to','iff'): sc=min(sc,(random.uniform(36,52) if t!='not' else random.uniform(26,34))/w)
        base={'(':54,')':54,',':58,'not':28,'and':26,'or':26,'imp':28,'to':28,'iff':28}.get(t,50 if (t.isupper() or t.isdigit()) else 50)
        yb=base+random.gauss(0,3)
        ox=x-x0*sc; oy=(yb-(y1*sc)) if t not in('not','imp','to','iff','and','or') else (yb-((y0+y1)/2*sc))
        if t in('(',')'): oy=yb-(y1*sc)+8
        if t==',': oy=yb-(y0*sc)
        out.append([[ [p[0]*sc+ox, p[1]*sc+oy] for p in s] for s in S]); x=x0*sc+ox+w*sc+random.uniform(7,16)
    return [s for g in out for s in g]
FORMS=["(A ⇒ (B ∨ C)) ∧ ((B ∨ C) ⇒ A)","(¬A ∨ B ∨ C) ∧ (¬(B ∨ C) ∨ A)","(¬A ∨ B ∨ C) ∧ ((¬B ∧ ¬C) ∨ A)","(¬A ∨ B ∨ C) ∧ (¬B ∨ A) ∧ (¬C ∨ A)",
 "¬(P ∨ ¬Q) ⇒ R","¬¬(P ∨ ¬Q) ∨ R","P ∨ ¬Q ∨ R","(P ∨ Q) ⇒ (R ∧ S)","¬(P ∨ Q) ∨ (R ∧ S)","(¬P ∧ ¬Q) ∨ (R ∧ S)","(¬P ∨ R) ∧ (¬P ∨ S) ∧ (¬Q ∨ R) ∧ (¬Q ∨ S)",
 "P ⇔ Q","(P ⇒ Q) ∧ (Q ⇒ P)","(¬P ∨ Q) ∧ (¬Q ∨ P)","B1,1 ⇔ (P1,2 ∨ P2,1)","(B1,1 ⇒ (P1,2 ∨ P2,1)) ∧ ((P1,2 ∨ P2,1) ⇒ B1,1)","¬B1,1","¬P1,2 ∧ ¬P2,1","¬(P1,2 ∨ P2,1)",
 "A ⇒ (B ∧ C)","¬A ∨ (B ∧ C)","(¬A ∨ B) ∧ (¬A ∨ C)","Q ∨ R","¬Q","P ⇒ Q","(R ∨ P) ∧ (R ∨ Q)","¬(A ∧ B)","¬A ∨ ¬B","(P ∧ Q) ⇒ R","¬(P ∧ Q) ∨ R","¬P ∨ ¬Q ∨ R"]
def toks(f):
    out=[];i=0
    while i<len(f):
        c=f[i]
        if c==' ': i+=1;continue
        out.append(SYM.get(c,c)); i+=1
    return out
lex_of=lambda f: sorted(set(__import__('re').findall(r'[A-Z][a-z]*(?:\d+,?\d*)?',f)))
cases=[]
for rep in range(6):
    for f in FORMS: cases.append({'truth':f,'lexicon':lex_of(f),'strokes':layout(toks(f))})
json.dump(cases,open('./hw-data/jstest/cases.json','w')); print(len(cases),'cases')
