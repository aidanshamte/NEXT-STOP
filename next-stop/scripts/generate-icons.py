"""Rebuild raster app icons with Pillow; editable vector master is assets/brand/next-stop-mark.svg."""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
S=3
for name,size,adaptive in [('icon.png',1024,False),('adaptive-icon.png',1024,True),('favicon.png',128,False)]:
    im=Image.new('RGBA',(size*S,size*S),'#11243A' if not adaptive else (0,0,0,0))
    draw=ImageDraw.Draw(im)
    scale=size*S/64
    # Android adaptive icon keeps the mark within the central safe area.
    def xy(x,y):
        if adaptive:x,y=32+(x-32)*.72,32+(y-32)*.72
        return (x*scale,y*scale)
    w=7*scale*(.72 if adaptive else 1)
    points=[xy(18,45),xy(18,19),xy(46,45),xy(46,19)]
    draw.line(points,fill='#EF543F',width=round(w),joint='curve')
    for x,y in points:
        draw.ellipse((x-w/2,y-w/2,x+w/2,y+w/2),fill='#EF543F')
    for x,y in [xy(18,45),xy(46,19)]:
        r=4*scale*(.72 if adaptive else 1)
        draw.ellipse((x-r,y-r,x+r,y+r),fill='white')
    im.resize((size,size),Image.Resampling.LANCZOS).save(ROOT/'assets'/name)
