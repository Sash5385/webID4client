from router import *
import json
near=(40,1100)
def Q(s,n=near): return sfx(s,*n)
def D(x,z,dx,dz,hw=None,rad=60): 
    n=nearest_dir(x,z,dx,dz,rad,hw)
    assert n,(x,z)
    return n
S=10314508703
wps=[S,(9,1338),Q('055847'),Q('055686'),Q('967696'),Q('519403'),Q('228162'),
     D(317,729,-0.5,-0.85,'secondary'), D(-180,-70,-0.5,-0.85,'secondary'),
     D(-662,-893,-0.5,-0.85,'secondary'),
     436145705, 10797505040, D(-1030,-190,0.5,0.87),
     D(-300,105,1,0), 529722348, D(-300,105,-1,0),
     D(-1030,-190,-0.5,-0.87), 750907492, 1545837196,
     D(-687,-913,0.5,0.85,'secondary'), D(-185,-54,0.5,0.85,'secondary'),
     26228940,338352701,1545897570,7097676976,S]
if __name__=='__main__':
    p=route(wps); print(round(plen(p)),len(p))
    json.dump(p,open('r3_path.json','w'))
    overlay(p,'r3o.png',-350,-100,1800,1100,2.2)
