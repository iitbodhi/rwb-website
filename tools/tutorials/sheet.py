import json, sys
from PIL import Image, ImageDraw
S='/home/claude/work/tut3'
for n in sys.argv[1:]:
    d=json.load(open(f'{S}/data/{n}.json')); beats=[(si,s['cap']['title'],b) for si,s in enumerate(d['scenes']) for b in s['beats']]
    W,H=234,506; cols=8; rows=(len(beats)+cols-1)//cols
    g=Image.new('RGB',(W*cols,(H+30)*rows),'white'); dr=ImageDraw.Draw(g)
    for i,(si,t,b) in enumerate(beats):
        im=Image.open(f"{S}/{b['img']}").convert('RGB').resize((W,H)); di=ImageDraw.Draw(im); k=W/390
        if b.get('box'): x,y,w,h=b['box']; di.rectangle([x*k,y*k,(x+w)*k,(y+h)*k],outline='lime',width=2)
        if b.get('tap'): x,y=b['tap']; di.ellipse([x*k-9,y*k-9,x*k+9,y*k+9],outline='red',width=3)
        X,Y=(i%cols)*W,(i//cols)*(H+30); g.paste(im,(X,Y+30)); dr.text((X+4,Y+4),f"{si+1}. {t}",fill='black')
    g.save(f'{S}/sheet-{n}.jpg',quality=75)
