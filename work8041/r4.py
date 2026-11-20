from router import *
import json,sys
S=10314508703
def nn(x,z,hw=None,rad=45): return nearest(x,z,rad,True,hw)
order=sys.argv[1] if len(sys.argv)>1 else 'ne_nw'
loops=[354729987,1256056962]
wps=[S,(91,1364),(557,1367),(660,1262),
     (910,1256),(1264,1506),1051846755,(1130,1663),(60,1572),(1130,1660),670881946,(1284,1550),
     *loops,
     26228940,1256056826,338352701,1545897570,7097676976,S]
if __name__=='__main__':
    p=route(wps); print(order,round(plen(p)),len(p))
    json.dump(p,open('r4_path_%s.json'%order,'w'))
    overlay(p,'r4o_%s.png'%order,600,1300,1800,1000,1.3)
    overlay(p,'r4c_%s.png'%order,350,900,1300,800,0.6)
