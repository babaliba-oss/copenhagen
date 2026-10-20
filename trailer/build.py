#!/usr/bin/env python3
"""Assembles the trailer from the 1080p60 cuts (cut/*.mp4, from the device), the EDL (edl.json) and the music.
  python3 build.py <cuts dir> <out dir> [--final]
Overlays (titles, captions, cards) are PNGs drawn with PIL in the game's own type: Spectral (serif, the banners) and
Manrope (sans, the HUD). Each segment becomes seg_NN.mp4 with identical encoding; they are joined losslessly and the
music is added at the end.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

CUTS, OUT = sys.argv[1], sys.argv[2]
FINAL = '--final' in sys.argv
FEED = '--feed' in sys.argv   # 4:5 for the LinkedIn feed: the 16:9 frame centre-cropped to 1:1, captions in a band below
os.makedirs(OUT, exist_ok=True)
E = json.load(open(os.path.join(os.path.dirname(__file__), 'edl.json')))
W, H, FPS = (1080, 1350, 60) if FEED else (1920, 1080, 60)
VID_Y = 135  # feed: the square video sits here; bands of 135 px above and below
FRAME = 'null'
def feed_frame(tag, zoom=1.0, x=None):
    """4:5: the 16:9 frame blown up and blurred fills the canvas; the sharp picture (a 1:1 crop, or a little more of the
    frame at zoom < 1 where a HUD popup sits at the edge) lies over it, centred. `x`: the crop's left edge in the scaled frame."""
    w, h = round(1920 * zoom), round(1080 * zoom); ch = min(1080, h); x = round((w - 1080) / 2) if x is None else x
    return (f"split[bg{tag}][fg{tag}];[bg{tag}]scale=2400:1350,crop=1080:1350,boxblur=28:3,eq=brightness=-0.2:saturation=0.85[bgb{tag}];"
            f"[fg{tag}]scale={w}:{h},crop=1080:{ch}:{x}:0[fgc{tag}];[bgb{tag}][fgc{tag}]overlay=0:{(1350 - ch) // 2}")
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'fonts')
SERIF = f'{REPO}/spectral/Spectral-SemiBold.ttf'
SERIF_R = f'{REPO}/spectral/Spectral-Regular.ttf'
SANS = f'{REPO}/manrope/Manrope-Variable.ttf'
ENC = ['-c:v', 'libx264', '-preset', 'medium' if FINAL else 'veryfast', '-crf', '16' if FINAL else '20', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-an', '-movflags', '+faststart']
CREAM = (246, 241, 230, 255); INK = (18, 17, 20, 255); RED = (178, 48, 44, 255); GREY = (200, 196, 186, 255)

def font(path, size, weight=None):
    f = ImageFont.truetype(path, size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)[:400]); print(r.stderr[-2000:]); sys.exit(1)

def shadowed(img, alpha_blur=10):
    """a soft dark shadow under everything drawn on an RGBA layer (legibility over bright streets)"""
    a = img.split()[3].filter(ImageFilter.GaussianBlur(alpha_blur))
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); sh.putalpha(a.point(lambda v: int(v * .75)))
    return Image.alpha_composite(sh, img)

def caption_png(text, path, style='band'):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    if FEED and style == 'box':  # the stacked split has no band: a box at the bottom left of the lower half, as in 16:9
        f = font(SANS, 40, 600); pad_x, pad_y = 28, 16; tw = d.textlength(text, font=f); th = 48
        x0, y0 = 48, H - 56 - th - 2 * pad_y
        d.rounded_rectangle([x0, y0, x0 + tw + 2 * pad_x, y0 + th + 2 * pad_y], radius=12, fill=(14, 14, 18, 170))
        d.rounded_rectangle([x0, y0 + 8, x0 + 5, y0 + th + 2 * pad_y - 8], radius=2, fill=RED)
        d.text((x0 + pad_x + 4, y0 + pad_y - 3), text, font=f, fill=CREAM); img.save(path); return
    if FEED:
        f = font(SANS, 44, 600); tw = d.textlength(text, font=f)
        if tw > W - 80:  # two lines, split near the middle at a space
            words = text.split(' '); best = min(range(1, len(words)), key=lambda i: abs(d.textlength(' '.join(words[:i]), font=f) - d.textlength(' '.join(words[i:]), font=f)))
            lines = [' '.join(words[:best]), ' '.join(words[best:])]
        else: lines = [text]
        y = VID_Y + 1080 + (135 - 54 * len(lines)) / 2 - 4
        mw = max(d.textlength(ln, font=f) for ln in lines)
        d.rounded_rectangle([W / 2 - mw / 2 - 30, y - 10, W / 2 + mw / 2 + 30, y + 54 * len(lines) + 6], radius=12, fill=(14, 14, 18, 170))
        for ln in lines:
            w = d.textlength(ln, font=f); d.text(((W - w) / 2, y), ln, font=f, fill=CREAM); y += 54
        d.rounded_rectangle([W / 2 - 24, VID_Y + 1080 + 10, W / 2 + 24, VID_Y + 1080 + 14], radius=2, fill=RED)
        img.save(path); return
    f = font(SANS, 50, 600); pad_x, pad_y = 36, 22
    tw = d.textlength(text, font=f); th = 58
    x0, y0 = 96, H - 96 - th - 2 * pad_y
    box = Image.new('RGBA', (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(box)
    bd.rounded_rectangle([x0, y0, x0 + tw + 2 * pad_x, y0 + th + 2 * pad_y], radius=14, fill=(14, 14, 18, 150))
    box = box.filter(ImageFilter.GaussianBlur(.6))
    img = Image.alpha_composite(img, box); d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0 + 10, x0 + 6, y0 + th + 2 * pad_y - 10], radius=3, fill=RED)  # accent bar
    d.text((x0 + pad_x + 6, y0 + pad_y - 4), text, font=f, fill=CREAM)
    img.save(path)

def logo(width):
    im = Image.open(os.path.join(os.path.dirname(__file__), 'logo.png')).convert('RGBA')
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)

def title_png(path):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    lg = logo(900 if FEED else 1360); img.alpha_composite(lg, ((W - lg.width) // 2, (VID_Y + 540 if FEED else H // 2) - lg.height // 2 - (0 if FEED else 40)))
    shadowed(img, 16).save(path)

def card_png(lines, path, reveal=None):
    """black card; `reveal` = how many lines are visible"""
    img = Image.new('RGBA', (W, H), (10, 10, 12, 255)); d = ImageDraw.Draw(img)
    f1 = font(SERIF, 120 if FEED else 140); f2 = font(SERIF_R, 64 if FEED else 76)
    n = len(lines) if reveal is None else reveal; y1, y2 = (560, 740) if FEED else (380, 580)
    if n >= 1:
        w = d.textlength(lines[0], font=f1); d.text(((W - w) / 2, y1), lines[0], font=f1, fill=CREAM)
    if n >= 2:
        w = d.textlength(lines[1], font=f2); d.text(((W - w) / 2, y2), lines[1], font=f2, fill=GREY)
    img.save(path)

def end_png(path):
    img = Image.new('RGBA', (W, H), (10, 10, 12, 255)); d = ImageDraw.Draw(img)
    lg = logo(900 if FEED else 1040); img.alpha_composite(lg, ((W - lg.width) // 2, 300 if FEED else 150))
    f3 = font(SANS, 64, 700); f4 = font(SANS, 26 if FEED else 28, 500)
    t = 'gtcopenhagen.com'; w = d.textlength(t, font=f3); yb = 880 if FEED else 720
    d.rounded_rectangle([(W - w) / 2 - 40, yb, (W + w) / 2 + 40, yb + 100], radius=16, fill=(246, 241, 230, 255))
    d.text(((W - w) / 2, yb + 16), t, font=f3, fill=INK)
    lines = ['Made by Daniel Șfița  ·  Built on worldhood by Lasse Saari',
             'Map data © OpenStreetMap contributors', '3D buildings: Københavns Kommune (CC BY 4.0)', 'Music: Rock Me Now by Pufino (freetouse.com)'] if FEED else ['Made by Daniel Șfița  ·  Built on worldhood by Lasse Saari',
             'Map data © OpenStreetMap contributors  ·  3D buildings: Københavns Kommune (CC BY 4.0)', 'Music: Rock Me Now by Pufino (freetouse.com)']
    for i, t in enumerate(lines):
        w = d.textlength(t, font=f4); d.text(((W - w) / 2, (1060 if FEED else 880) + i * 42), t, font=f4, fill=GREY)
    img.save(path)

def label_png(text, path, x, y=None):
    """small era label at the top of a split-screen half"""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    f = font(SANS, 30, 700); spaced = '  '.join(text)
    tw = d.textlength(spaced, font=f)
    y = 56 if y is None else y
    d.rounded_rectangle([x - tw / 2 - 26, y, x + tw / 2 + 26, y + 62], radius=12, fill=(14, 14, 18, 150))
    d.text((x - tw / 2, y + 12), spaced, font=f, fill=CREAM)
    img.save(path)

def overlay_args(png, start, end, fade=.35, hold_to_end=False):
    """ffmpeg filter for a PNG overlay fading in at `start` and out before `end` (segment-local seconds)"""
    f = f"[ov]format=rgba,fade=t=in:st={start}:d={fade}:alpha=1"
    if not hold_to_end: f += f",fade=t=out:st={end - fade}:d={fade}:alpha=1"
    return f + "[ovf];"

ONLY = [a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')]; ONLY = ONLY[0] if ONLY else None  # rebuild these ids; keep the other segments
segs = E['segments']; parts = []; cum = 0.0
for s in segs:
    sid = s['id']; d = s['d']; out = f'{OUT}/seg_{sid}.mp4'; parts.append(out)
    if ONLY is not None and sid not in ONLY and os.path.exists(out): cum += d; continue
    inputs = []; fc = ''; vin = '[0:v]'
    if 'src' in s or 'split' in s or 'wipe' in s:
        if 'src' in s:
            fr = feed_frame(sid, **s.get('feed', {})) if FEED else FRAME
            inputs += ['-i', f'{CUTS}/c{sid}.mp4']; fc += f"[0:v]trim=start={s.get('in', 0)}:duration={d},setpts=PTS-STARTPTS,{fr}[v0];"; vin = '[v0]'
        elif 'split' in s:
            inputs += ['-i', f'{CUTS}/c{sid}a.mp4', '-i', f'{CUTS}/c{sid}b.mp4']
            ina = s['split'][0][2] if len(s['split'][0]) > 2 else 0; inb = s['split'][1][2] if len(s['split'][1]) > 2 else 0  # optional offsets into each cut
            if FEED: fc += (f"[0:v]trim=start={ina}:duration={d},setpts=PTS-STARTPTS,scale=1193:671,crop=1080:671:56:0[a];[1:v]trim=start={inb}:duration={d},setpts=PTS-STARTPTS,scale=1193:671,crop=1080:671:56:0[b];"
                            f"color=c=0xF6F1E6:s=1080x8:r={FPS}:d={d}[bar];[a][bar][b]vstack=inputs=3[v0];")  # today above 1760, each nearly the whole 16:9 frame
            else: fc += (f"[0:v]trim=start={ina}:duration={d},setpts=PTS-STARTPTS,crop=956:1080:482:0[a];[1:v]trim=start={inb}:duration={d},setpts=PTS-STARTPTS,crop=956:1080:482:0[b];"
                   f"color=c=0xF6F1E6:s=8x1080:r={FPS}:d={d}[bar];[a][bar][b]hstack=inputs=3[v0];")
            la, lb = f'{OUT}/lab_today.png', f'{OUT}/lab_1760.png'
            if not os.path.exists(la):
                if FEED: label_png('TODAY', la, 540, 36); label_png('1760', lb, 540, 671 + 8 + 36)
                else: label_png('TODAY', la, 480); label_png('1760', lb, 1440)
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', la, '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', lb]
            fc += f"[2:v]format=rgba,fade=t=in:st=0.2:d=0.3:alpha=1[la];[3:v]format=rgba,fade=t=in:st=0.2:d=0.3:alpha=1[lb];[v0][la]overlay=shortest=1[v1];[v1][lb]overlay=shortest=1[v0b];"
            vin = '[v0b]'
        else:
            (sa, ta, da), (sb, tb, db) = s['wipe']; x = s['xfade']
            inputs += ['-i', f'{CUTS}/c{sid}a.mp4', '-i', f'{CUTS}/c{sid}b.mp4']
            fa, fb = (feed_frame(sid + 'a'), feed_frame(sid + 'b')) if FEED else (FRAME, FRAME)
            fc += f"[0:v]trim=duration={da},setpts=PTS-STARTPTS,{fa}[a];[1:v]trim=duration={db},setpts=PTS-STARTPTS,{fb}[b];[a][b]xfade=transition=wipeleft:duration={x}:offset={da - x}[v0];"
            vin = '[v0]'
        n_in = len([i for i in inputs if i == '-i'])
        if s.get('title'):
            png = f'{OUT}/title.png'; title_png(png)
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', png]
            fc += f"[{n_in}:v]format=rgba,fade=t=in:st=0.6:d=0.6:alpha=1[ovf];{vin}[ovf]overlay=shortest=1[vo];"; vin = '[vo]'
        elif s.get('cap'):
            png = f'{OUT}/cap_{sid}.png'; caption_png(s['cap'], png, 'box' if 'split' in s else 'band')
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', png]
            fc += f"[{n_in}:v]format=rgba,fade=t=in:st=0.3:d=0.35:alpha=1,fade=t=out:st={d - .5}:d=0.35:alpha=1[ovf];{vin}[ovf]overlay=shortest=1[vo];"; vin = '[vo]'
        # a 6-frame dip at the very start of the first shot and the last seasonal shot is handled by the cards around them
        fc += f"{vin}format=yuv420p[vout]"
        run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', fc, '-map', '[vout]', '-t', str(d), *ENC, out])
    elif 'card' in s:
        p1, p2 = f'{OUT}/card1.png', f'{OUT}/card2.png'; card_png(s['card'], p1, 1); card_png(s['card'], p2, 2)
        # line one fades in at .35 s; line two joins at 1.9 s; the whole card fades to black over the last .4 s
        black = f'{OUT}/black.png'; Image.new('RGB', (W, H), (10, 10, 12)).save(black)
        fc = (f"[0:v]format=rgba[bg];[1:v]format=rgba,fade=t=in:st=0.35:d=0.5:alpha=1[c1];[2:v]format=rgba,fade=t=in:st=1.9:d=0.5:alpha=1[c2];"
              f"[bg][c1]overlay[x];[x][c2]overlay,fade=t=out:st={d - .4}:d=0.4,format=yuv420p[vout]")
        run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', black, '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', p1,
             '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', p2, '-filter_complex', fc, '-map', '[vout]', '-t', str(d), *ENC, out])
    elif s.get('end'):
        p = f'{OUT}/end.png'; end_png(p)
        run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', p, '-vf', f'fade=t=in:st=0:d=0.6,fade=t=out:st={d - .8}:d=0.8,format=yuv420p', '-t', str(d), *ENC, out])
    cum += d; print(sid, 'done', round(cum, 1), flush=True)

with open(f'{OUT}/list.txt', 'w') as f:
    for p in parts: f.write(f"file '{os.path.abspath(p)}'\n")
run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{OUT}/list.txt', '-c', 'copy', f'{OUT}/video.mp4'])
music = os.path.join(os.path.dirname(__file__), 'music.wav')
run(['ffmpeg', '-v', 'error', '-y', '-i', f'{OUT}/video.mp4', '-i', music, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-shortest', '-movflags', '+faststart', f'{OUT}/trailer.mp4'])
print('trailer', f'{OUT}/trailer.mp4')
