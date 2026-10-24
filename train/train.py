import numpy as np,json,torch,torch.nn as nn,torch.nn.functional as F,time,sys
torch.set_num_threads(8); torch.manual_seed(0)
d=np.load('ds.npz'); C=json.load(open('classes.json'))
X=torch.tensor(d['X'],dtype=torch.float32).unsqueeze(1)/255.; A=torch.tensor(d['A']).clamp(-3,3).unsqueeze(1); Y=torch.tensor(d['Y'])
src=d['SRC']; h=np.array([hash(s)%10 for s in src]); va=torch.tensor(h==0); tr=~va
class Net(nn.Module):
    def __init__(s,n):
        super().__init__()
        s.c1=nn.Conv2d(1,24,3,padding=1); s.c2=nn.Conv2d(24,32,3,padding=1)
        s.c3=nn.Conv2d(32,48,3,padding=1); s.c4=nn.Conv2d(48,64,3,padding=1); s.c5=nn.Conv2d(64,96,3,padding=1)
        s.f1=nn.Linear(96*4*4+1,192); s.f2=nn.Linear(192,n)
    def feat(s,x,a):
        x=F.relu(s.c1(x)); x=F.max_pool2d(F.relu(s.c2(x)),2)       # 16
        x=F.relu(s.c3(x)); x=F.max_pool2d(F.relu(s.c4(x)),2)       # 8
        x=F.max_pool2d(F.relu(s.c5(x)),2)                           # 4
        return F.relu(s.f1(torch.cat([x.flatten(1),a],1)))
    def forward(s,x,a): return s.f2(F.dropout(s.feat(x,a),0.3,s.training))
net=Net(len(C)); print(sum(p.numel() for p in net.parameters()),'params')
cnt=torch.bincount(Y[tr],minlength=len(C)).float(); w=(1/cnt[Y[tr]]).double()
samp=torch.utils.data.WeightedRandomSampler(w,len(w))
Xt,At,Yt=X[tr],A[tr],Y[tr]
opt=torch.optim.AdamW(net.parameters(),2e-3,weight_decay=1e-4); E=int(sys.argv[1]) if len(sys.argv)>1 else 14
sched=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3,total_steps=E*(len(w)//256+1))
def aug(x):
    n=x.shape[0]; ang=torch.randn(n)*0.10; sc=torch.exp(torch.randn(n)*0.08); sh=torch.randn(n)*0.10
    th=torch.stack([torch.stack([sc*torch.cos(ang),-sc*torch.sin(ang)+sh,torch.randn(n)*0.04],1),torch.stack([sc*torch.sin(ang),sc*torch.cos(ang),torch.randn(n)*0.04],1)],1)
    g=F.affine_grid(th,x.shape,align_corners=False); x=F.grid_sample(x,g,align_corners=False)
    m=torch.rand(n)<0.3; x[m]=F.max_pool2d(x[m],3,1,1) if m.any() else x[m]
    return x
for ep in range(E):
    net.train(); t=time.time(); idx=torch.tensor(list(samp)); L=0
    for b in range(0,len(idx),256):
        j=idx[b:b+256]; out=net(aug(Xt[j]),At[j]); loss=F.cross_entropy(out,Yt[j],label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); L+=loss.item()
    net.eval()
    with torch.no_grad(): p=net(X[va],A[va]).argmax(1)
    acc=(p==Y[va]).float().mean().item(); print(ep,round(L/(len(idx)/256),3),'val',round(acc,4),round(time.time()-t),'s',flush=True)
torch.save(net.state_dict(),'net.pt')
with torch.no_grad(): p=net(X[va],A[va]).argmax(1)
conf={}
for a,b in zip(Y[va].tolist(),p.tolist()):
    if a!=b: conf[(C[a],C[b])]=conf.get((C[a],C[b]),0)+1
print(sorted(conf.items(),key=lambda x:-x[1])[:40])
