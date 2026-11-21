from router import *
import json
near=(40,1100)
def Q(s,n=near): return sfx(s,*n)
S=10314508703
e=ways[23145427][0]; w=ways[23145431][0]
wps=[S,(9,1338),Q('055847'),Q('055686'),Q('967696'),Q('519403'),Q('228162'),
     e[0],e[-1],w[0],w[-1],
     1256056962,26228940,338352701,1545897570,7097676976,S]
if __name__=='__main__':
    p=route(wps); print(round(plen(p)),len(p))
    json.dump(p,open('r2_path.json','w'))
    overlay(p,'r2o.png',900,700,1800,1000,3.2)
