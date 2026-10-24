import torch,json,numpy as np,sys
sd=torch.load(sys.argv[1] if len(sys.argv)>1 else 'net.pt'); C=json.load(open('classes.json'))
names=['c1.weight','c1.bias','c2.weight','c2.bias','c3.weight','c3.bias','c4.weight','c4.bias','c5.weight','c5.bias','f1.weight','f1.bias','f2.weight','f2.bias']
meta={'classes':C,'ch':[sd['c%d.weight'%i].shape[0] for i in range(1,6)],'tensors':[]}; buf=[]
for n in names:
    a=sd[n].float().numpy().ravel(); s=float(np.abs(a).max()/127) or 1e-8
    q=np.clip(np.round(a/s),-127,127).astype(np.int8); buf.append(q.tobytes())
    meta['tensors'].append({'name':n,'shape':list(sd[n].shape),'scale':s})
out=sys.argv[2] if len(sys.argv)>2 else '.'
open(out+'/ink-model.bin','wb').write(b''.join(buf)); json.dump(meta,open(out+'/ink-model.json','w'))
print(sum(len(b) for b in buf),'bytes')
