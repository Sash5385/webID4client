from osmg import *
from PIL import Image, ImageDraw, ImageFont
import sys
nodes,ways=load()
COL={'construction':(220,190,40),'motorway':(200,60,60),'motorway_link':(200,60,60),'trunk':(220,120,40),'trunk_link':(220,120,40),'primary':(230,150,40),'primary_link':(230,150,40),'secondary':(220,190,40),'secondary_link':(220,190,40),'tertiary':(90,90,90),'tertiary_link':(90,90,90),'residential':(130,130,130),'unclassified':(130,130,130),'service':(170,170,200),'living_street':(130,130,130)}
F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11)
def render(cx,cz,w,h,scale,out,ids=True,names=True):
    # window center (m) w,h in pixels, scale m/px
    im=Image.new('RGB',(w,h),(248,248,248)); d=ImageDraw.Draw(im)
    def tp(p): return ((p[0]-cx)/scale+w/2,(p[1]-cz)/scale+h/2)
    deg={}
    for i,(nd,t) in ways.items():
        hw=t.get('highway')
        if t.get('railway')=='rail':
            pts=[tp(xy(n,nodes)) for n in nd if n in nodes]; d.line(pts,fill=(120,60,60),width=1); continue
        if hw not in COL: continue
        pts=[tp(xy(n,nodes)) for n in nd if n in nodes]
        wd=3 if hw in('secondary','primary','trunk','motorway','secondary_link','primary_link','trunk_link','motorway_link') else 2 if hw in('tertiary','residential','unclassified') else 1
        d.line(pts,fill=COL[hw],width=wd)
        ow=t.get('oneway')=='yes'
        if ow:
            for a,b in zip(pts[:-1],pts[1:]):
                L=math.hypot(b[0]-a[0],b[1]-a[1])
                if L>25:
                    mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2; ux,uy=(b[0]-a[0])/L,(b[1]-a[1])/L
                    d.polygon([(mx+ux*5,my+uy*5),(mx-ux*3-uy*3,my-uy*3+ux*3),(mx-ux*3+uy*3,my-uy*3-ux*3)],fill=(0,90,200))
        for n in nd: deg[n]=deg.get(n,0)+1
        if names and t.get('name') and len(pts)>1:
            m=pts[len(pts)//2]
            if 0<m[0]<w and 0<m[1]<h: d.text((m[0]+3,m[1]+3),t['name'][:22],fill=(0,0,0),font=F)
    if ids:
        for n,c in deg.items():
            if c>=2 and n in nodes:
                p=tp(xy(n,nodes))
                if 0<p[0]<w and 0<p[1]<h: d.text((p[0]+2,p[1]-10),str(n)[-6:],fill=(180,0,120),font=F)
    im.save(out)
if __name__=='__main__':
    a=sys.argv; render(float(a[1]),float(a[2]),int(a[3]),int(a[4]),float(a[5]),a[6],ids=(a[7]=='1') if len(a)>7 else True)
