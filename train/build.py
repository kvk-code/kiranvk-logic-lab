import csv,json,os,pickle,random,re,collections,numpy as np
from PIL import Image,ImageDraw
R=32; BOX=26; SS=4
HASYMAP={'\\wedge':'and','\\vee':'or','\\neg':'not','\\sim':'sim','\\Rightarrow':'imp','\\rightarrow':'to','\\longrightarrow':'to',
 '\\Leftrightarrow':'iff','\\leftrightarrow':'lr','\\forall':'all','\\exists':'ex','\\bot':'bot','\\perp':'bot','\\top':'top','\\&':'amp'}
for ch in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-=<>|': HASYMAP[ch]=ch
CLASSES=sorted(set(HASYMAP.values())|{'(',')',','},key=lambda s:(len(s)>1,s))
CI={c:i for i,c in enumerate(CLASSES)}
def render_strokes(S,width,rng):
    pts=np.concatenate([np.array(s) for s in S]); x0,y0=pts.min(0); x1,y1=pts.max(0)
    w,h=max(x1-x0,1e-3),max(y1-y0,1e-3); sc=BOX/max(w,h)
    ox=(R-w*sc)/2-x0*sc; oy=(R-h*sc)/2-y0*sc
    im=Image.new('L',(R*SS,R*SS),0); d=ImageDraw.Draw(im); lw=max(1,int(round(width*SS)))
    for s in S:
        p=[((x*sc+ox)*SS,(y*sc+oy)*SS) for x,y in s]
        if len(p)==1: p=p*2
        d.line(p,fill=255,width=lw,joint='curve')
        for q in (p[0],p[-1]): d.ellipse([q[0]-lw/2,q[1]-lw/2,q[0]+lw/2,q[1]+lw/2],fill=255)
    return np.asarray(im.resize((R,R),Image.BILINEAR),np.uint8), np.log(w/h)
def jitter(S,rng):
    # random affine + small per-point noise on the ink
    a=rng.normal(0,0.12); sh=rng.normal(0,0.18); sx=np.exp(rng.normal(0,0.12)); 
    M=np.array([[np.cos(a)*sx,-np.sin(a)+sh],[np.sin(a),np.cos(a)]])
    pts=np.concatenate([np.array(s) for s in S]); c=pts.mean(0); scale=max(np.ptp(pts[:,0]),np.ptp(pts[:,1]),1)
    return [((np.array(s)-c)@M.T+rng.normal(0,0.008*scale,(len(s),2))).tolist() for s in S]
def hasy_img(path,rng):
    a=255-np.asarray(Image.open(path).convert('L'),np.uint8); ys,xs=np.nonzero(a>80)
    if len(xs)==0: return None
    c=a[ys.min():ys.max()+1,xs.min():xs.max()+1]; h,w=c.shape; sc=BOX/max(h,w)
    im=Image.fromarray(c).resize((max(1,round(w*sc)),max(1,round(h*sc))),Image.BILINEAR)
    from PIL import ImageFilter
    k=rng.choice([1,3,3]); 
    if k>1: im=im.filter(ImageFilter.MaxFilter(k))
    out=Image.new('L',(R,R),0); out.paste(im,((R-im.width)//2,(R-im.height)//2))
    return np.asarray(out,np.uint8), np.log(w/h)
if __name__=='__main__':
    rng=np.random.default_rng(0); X=[];A=[];Y=[];SRC=[]
    os.chdir('./hw-data/hasy')
    rows=[r for r in csv.DictReader(open('hasy-data-labels.csv')) if r['latex'] in HASYMAP]
    for r in rows:
        for k in range(1):
            o=hasy_img(r['path'],rng)
            if o: X.append(o[0]);A.append(o[1]);Y.append(CI[HASYMAP[r['latex']]]);SRC.append('h:'+r['user_id'])
    print('hasy',len(X))
    mined=pickle.load(open('./hw-data/work/mined.pkl','rb'))
    # curated symbols subset
    MW='./hw-data/mathwriting-2024'
    from mine import CMD,strokes
    for fn in os.listdir(MW+'/symbols'):
        t=open(MW+'/symbols/'+fn).read(); lbl=re.search(r'type="label">(.*?)</annotation>',t).group(1).replace('&amp;','&')
        lab=CMD.get(lbl,lbl if lbl in HASYMAP or lbl in '(),' else None)
        if lab in CI: mined.append((lab,strokes(t),fn))
    reps=collections.Counter()
    cnt=collections.Counter(l for l,_,_ in mined)
    for lab,S,fn in mined:
        if lab not in CI: continue
        n=int(np.clip(400/cnt[lab],2,12))
        for k in range(n):
            im,asp=render_strokes(jitter(S,rng) if k else S,rng.uniform(1.4,3.0),rng)
            X.append(im);A.append(asp);Y.append(CI[lab]);SRC.append('m:'+fn)
    X=np.stack(X);A=np.array(A,np.float32);Y=np.array(Y)
    np.savez_compressed('./hw-data/work/ds.npz',X=X,A=A,Y=Y,SRC=np.array(SRC))
    json.dump(CLASSES,open('./hw-data/work/classes.json','w'))
    print(X.shape, collections.Counter(CLASSES[y] for y in Y).most_common())
