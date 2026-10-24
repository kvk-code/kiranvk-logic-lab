# Mine single glyphs from MathWriting train inks whose labels are flat sequences of our symbols.
import os,re,sys,pickle,json,collections
from multiprocessing import Pool
D='./hw-data/mathwriting-2024'
CMD={'\\wedge':'and','\\vee':'or','\\neg':'not','\\lnot':'not','\\Rightarrow':'imp','\\rightarrow':'to','\\to':'to','\\implies':'imp',
     '\\Leftrightarrow':'iff','\\iff':'iff','\\leftrightarrow':'lr','\\forall':'all','\\exists':'ex','\\bot':'bot','\\perp':'bot','\\top':'top',
     '\\sim':'sim','\\&':'amp','\\land':'and','\\lor':'or'}
SIMPLE=set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789(),+-=<>|')
def toks(lbl):
    out=[];i=0
    while i<len(lbl):
        c=lbl[i]
        if c==' ': i+=1;continue
        if c=='\\':
            m=re.match(r'\\[A-Za-z]+|\\.',lbl[i:]); w=m.group(0)
            if w not in CMD: return None
            out.append(CMD[w]); i+=len(w); continue
        if c in SIMPLE: out.append(c); i+=1; continue
        return None
    return out
def strokes(txt):
    tr=re.findall(r'<trace(?:\s[^>]*)?>(.*?)</trace>',txt,re.S); S=[]
    for t in tr:
        pts=[tuple(map(float,p.split()[:2])) for p in t.strip().split(',') if p.strip()]
        if pts: S.append(pts)
    return S
def group(S):
    boxes=[(min(p[0] for p in s),max(p[0] for p in s)) for s in S]
    order=sorted(range(len(S)),key=lambda k:(boxes[k][0]+boxes[k][1])/2)
    groups=[]
    for k in order:
        a,b=boxes[k]; placed=False
        if groups:
            g=groups[-1]; ga,gb=g['x']
            ov=min(b,gb)-max(a,ga); w=max(1e-6,min(b-a,gb-ga,))
            if ov>0.45*max(w,1.0): g['s'].append(k); g['x']=(min(a,ga),max(b,gb)); placed=True
        if not placed: groups.append({'s':[k],'x':(a,b)})
    return groups
def work(fn):
    txt=open(os.path.join(D,'train',fn)).read()
    m=re.search(r'type="normalizedLabel">(.*?)</annotation>',txt)
    if not m: return []
    lbl=m.group(1).replace('&amp;','&').replace('&lt;','<').replace('&gt;','>')
    T=toks(lbl)
    if not T or len(T)<2 or len(T)>30: return []
    S=strokes(txt); G=group(S)
    if len(G)!=len(T): return []
    return [(t,[S[k] for k in sorted(g['s'])],fn) for t,g in zip(T,G)]
if __name__=='__main__':
    files=os.listdir(os.path.join(D,'train'))
    with Pool(8) as p: res=p.map(work,files,chunksize=500)
    out=[x for r in res for x in r]
    # add the curated symbols subset
    for l in open(os.path.join(D,'symbols.jsonl')): pass
    pickle.dump(out,open('./hw-data/work/mined.pkl','wb'))
    c=collections.Counter(t for t,_,_ in out); print(len(out),'glyphs from',len({f for *_,f in out}),'inks'); print(sorted(c.items(),key=lambda x:-x[1]))
