import xml.etree.ElementTree as ET, glob, math, pickle, os
P='/home/user/route7-sim/data/raw8041/'
def load():
    if os.path.exists('g.pkl'): return pickle.load(open('g.pkl','rb'))
    nodes={}; ways={}
    for f in sorted(glob.glob(P+'t_*.osm')):
        for ev,el in ET.iterparse(f):
            if el.tag=='node':
                nodes[int(el.get('id'))]=(float(el.get('lat')),float(el.get('lon')))
                el.clear()
            elif el.tag=='way':
                t={x.get('k'):x.get('v') for x in el.findall('tag')}
                if 'highway' in t or t.get('railway')=='rail':
                    ways[int(el.get('id'))]=([int(n.get('ref')) for n in el.findall('nd')],t)
                el.clear()
    pickle.dump((nodes,ways),open('g.pkl','wb')); return nodes,ways
LAT0,LON0=50.497,30.52
def xy(n,nodes):
    la,lo=nodes[n]; return ((lo-LON0)*math.cos(math.radians(LAT0))*111320,-(la-LAT0)*110574)
