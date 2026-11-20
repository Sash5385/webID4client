from osmg import *
import heapq, json, os
nodes,ways=load()
DRIVE={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','service','living_street'}
adj={}  # n -> list of (m, wayid, len)
rev={}
LOOSE=set()
def L(a,b):
    p,q=xy(a,nodes),xy(b,nodes); return math.hypot(p[0]-q[0],p[1]-q[1])
for wid,(nd,t) in ways.items():
    if t.get('highway') not in DRIVE: continue
    if t.get('access') in('no','private') and t.get('highway')=='service': pass
    hw0=t.get('highway')
    ow=t.get('oneway')
    if wid in LOOSE or (os.environ.get('LOOSE_SVC') and hw0=='service'): ow=None
    hw=t.get('highway')
    if ow is None and (hw in('motorway','motorway_link') or t.get('junction')=='roundabout'): ow='yes'
    fw = ow!='-1'; bw = ow not in('yes','true','1','-1')
    if ow=='-1': bw=True; fw=False
    for a,b in zip(nd[:-1],nd[1:]):
        if a not in nodes or b not in nodes: continue
        l=L(a,b)
        if fw: adj.setdefault(a,[]).append((b,wid,l)); rev.setdefault(b,[]).append(a)
        if bw: adj.setdefault(b,[]).append((a,wid,l)); rev.setdefault(a,[]).append(b)
pts={n:xy(n,nodes) for n in adj}
nodehw={}
for wid,(nd,t) in ways.items():
    for n in nd: nodehw.setdefault(n,set()).add(t.get('highway'))
def nearest(x,z,rad=40,need_both=True,hw=None):
    best=None;bd=rad
    for n,p in pts.items():
        d=math.hypot(p[0]-x,p[1]-z)
        if d<bd and (n in rev or not need_both) and n in adj and (hw is None or hw in nodehw.get(n,())): bd=d;best=n
    return best
def sfx(s,x=None,z=None):
    c=[n for n in pts if str(n).endswith(str(s))]
    if x is not None: c.sort(key=lambda n:math.hypot(pts[n][0]-x,pts[n][1]-z))
    return c[0] if c else None
def dij(a,b,ban=set(),pen=None):
    D={a:0};P={};h=[(0,a)]
    while h:
        d,u=heapq.heappop(h)
        if u==b: break
        if d>D[u]: continue
        for v,w,l in adj.get(u,[]):
            if w in ban: continue
            nd=d+l*(pen.get(w,1) if pen else 1)
            if nd<D.get(v,1e18): D[v]=nd;P[v]=(u,w);heapq.heappush(h,(nd,v))
    if b not in D: return None
    out=[b]
    while out[-1]!=a: out.append(P[out[-1]][0])
    return out[::-1]
def route(wps,ban=set(),pen=None):
    ids=[]
    for w in wps:
        if isinstance(w,int): ids.append(w)
        elif isinstance(w,str): ids.append(sfx(w))
        else: ids.append(nearest(*w))
    path=[ids[0]]
    for a,b in zip(ids[:-1],ids[1:]):
        r=dij(a,b,ban,pen)
        if r is None: raise Exception(f'no path {a}->{b} {pts.get(a)} {pts.get(b)}')
        path+=r[1:]
    return path
def plen(p): return sum(L(a,b) for a,b in zip(p[:-1],p[1:]))
def overlay(path,out,cx,cz,w,h,scale,wps=()):
    import rend
    rend.render(cx,cz,w,h,scale,out,ids=False,names=False)
    from PIL import Image,ImageDraw
    im=Image.open(out); d=ImageDraw.Draw(im)
    tp=lambda p:((p[0]-cx)/scale+w/2,(p[1]-cz)/scale+h/2)
    q=[tp(xy(n,nodes)) for n in path]
    d.line(q,fill=(0,200,0),width=3)
    for a,b in zip(q[::12][:-1],q[::12][1:]):
        l=math.hypot(b[0]-a[0],b[1]-a[1])
        if l>4: ux,uy=(b[0]-a[0])/l,(b[1]-a[1])/l; d.polygon([(b[0]+ux*6,b[1]+uy*6),(b[0]-uy*4,b[1]+ux*4),(b[0]+uy*4,b[1]-ux*4)],fill=(220,0,0))
    for wp in wps:
        if isinstance(wp,tuple):
            p=tp(wp); d.ellipse((p[0]-5,p[1]-5,p[0]+5,p[1]+5),outline=(255,0,255),width=2)
    im.save(out)
