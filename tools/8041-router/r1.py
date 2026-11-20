from router import *
import json
near=(40,1100)
def Q(s,n=near): return sfx(s,*n)
S=10314508703
wps=[S,(-495,1195),(-430,1195),(-416,1023),(-430,1195),(-495,1195),(-480,1000),(-453,941),
     Q('228162'),Q('967696'),Q('055686'),Q('055847'),(9,1338),(656,1262),(9,1338),
     Q('055847'),Q('055686'),Q('967696'),(452,1145),(664,1252),S]
if __name__=='__main__':
    wps=[w if not (isinstance(w,tuple) and len(w)==5) else nearest(*w) for w in wps]
    p=route(wps); print(round(plen(p)),len(p))
    json.dump(p,open('r1_path.json','w'))
    overlay(p,'r1o.png',100,1160,1800,800,0.8)
