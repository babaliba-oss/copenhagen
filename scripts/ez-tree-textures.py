# Shrinks the textures @dgreenheck/ez-tree inlines as base64 (about 4 MB of the game's main script). The
# game only uses bark colour + normal for birch, oak and pine and the oak, aspen and pine leaf cards (route-trees.js
# replaces the materials, so AO and roughness maps are never read). Used ones are written to public/ez-tree/ at
# 512 px WebP; vite.config.js swaps each data URL for its file (unused ones for a 1x1 pixel).
# Run after upgrading ez-tree: python3 scripts/ez-tree-textures.py
import re,base64,io,json,os
from PIL import Image
SRC='node_modules/@dgreenheck/ez-tree/build/ez-tree.es.js'
s=open(SRC).read()
USED={('bark','birch','color'),('bark','birch','normal'),('bark','oak','color'),('bark','oak','normal'),('bark','pine','color'),('bark','pine','normal'),('leaves','oak',None),('leaves','aspen',None),('leaves','pine',None)}
consts={m.group(1):m.group(2) for m in re.finditer(r'([A-Za-z_$][\w$]*) = "(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"',s)}
start=s.index('bark: {',s.index('ao: j(')-200);table=s[start:s.index('class ',start)]
out={};group=None;kind=None
for line in table.splitlines():
    t=line.strip()
    m=re.match(r'(bark|leaves): \{',t)
    if m: group=m.group(1);kind=None;continue
    m=re.match(r'(\w+): \{$',t)
    if m: kind=m.group(1);continue
    m=re.match(r'(\w+): j\(([\w$]+)',t)
    if m:
        key=(group,kind,m.group(1)) if group=='bark' else (group,m.group(1),None)
        name=m.group(2)
        if name not in consts: continue
        if key in USED:
            img=Image.open(io.BytesIO(base64.b64decode(consts[name].split(',',1)[1])))
            alpha=img.mode in ('RGBA','LA') or 'transparency' in img.info
            img=img.convert('RGBA' if alpha else 'RGB')
            if max(img.size)>512: img=img.resize((512,512*img.size[1]//img.size[0]),Image.LANCZOS)
            fn='-'.join(k for k in key if k)+'.webp'
            img.save('public/ez-tree/'+fn,'WEBP',quality=82,method=6,lossless=False,exact=alpha)
            out[name]='ez-tree/'+fn
        else: out[name]=None
json.dump(out,open('public/ez-tree/map.json','w'),indent=1)
print(len(consts),'inlined;',sum(1 for v in out.values() if v),'kept;',sum(1 for v in out.values() if not v),'dropped')
