#!/usr/bin/env python3
"""
Apex demo producer v2 (real footage only).
Inputs : out/ (capture.mjs output: frames, marks.json, facts.json, steps.json), narration_final.json
Usage  : ~/venv-apex/bin/python produce_v2.py [--dest DIR] [--tts kokoro|dummy]
         Re-run the same command until it prints OK (every heavy step is cached and resumable).
'dummy' (silent timing) exists only to test the pipeline; its output is never a deliverable.
"""
import json, os, re, subprocess, sys, shutil, wave, math, random, bisect, hashlib
import numpy as np
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
DEST = arg('--dest', os.path.join(HERE, 'Apex_Demo_Final'))
TTS = arg('--tts', 'kokoro'); MODEL_DIR = arg('--model-dir', os.path.join(HERE, 'voice-model'))
OUT = os.path.join(HERE, 'out'); WORK = arg('--work', os.path.join(HERE, 'work'))
W, H, FPS = 1920, 1080, 30
FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-%s.ttf'
CY, BL, PU = (34, 211, 238), (59, 130, 246), (168, 85, 247)
LEAD, TAIL = 0.6, 0.9


P = lambda x: str(x).replace('\\', '/')   # ffconcat treats backslashes as escapes: always use forward slashes in list files


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, cwd=cwd)
    if r.returncode:
        raise SystemExit('COMMAND FAILED:\n' + (cmd if isinstance(cmd, str) else ' '.join(cmd)) + '\n' + r.stderr[-1500:])
    return r


FONT_CANDIDATES = {
    'Regular': [FONT % 'Regular', 'C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'Light': [FONT % 'Light', 'C:/Windows/Fonts/segoeuil.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'Medium': [FONT % 'Medium', 'C:/Windows/Fonts/seguisb.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    'Bold': [FONT % 'Bold', 'C:/Windows/Fonts/segoeuib.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
}
SUB_FONT = 'Poppins' if os.path.exists(FONT % 'Regular') else 'Segoe UI'


@lru_cache(None)
def f(sz, w='Regular'):
    for p in FONT_CANDIDATES[w]:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    raise SystemExit('No usable font found for ' + w)


def cached(path, key):
    k = path + '.key'
    return os.path.exists(path) and os.path.exists(k) and open(k).read() == key


def stamp(path, key): open(path + '.key', 'w').write(key)


os.makedirs(WORK, exist_ok=True); os.makedirs(f'{WORK}/seg', exist_ok=True); os.makedirs(DEST, exist_ok=True)
marks = {m['name']: m['t'] for m in json.load(open(f'{OUT}/marks.json'))['marks']}
facts = json.load(open(f'{OUT}/facts.json')); steps = json.load(open(f'{OUT}/steps.json'))
facts['signoutOk'] = any(s.get('label') == 'sign out' and s.get('ok') for s in steps)
nar = json.load(open(os.path.join(HERE, 'narration_final_v2.json')))

# ------------------------------------------------------------------ frame timeline (true screencast order)
FI = f'{WORK}/frame_index.json'
if not os.path.exists(FI):
    names, durs = [], []
    for l in open(f'{OUT}/frames.ffconcat').read().split('\n'):
        m = re.match(r"file 'frames/(.*)'", l)
        if m: names.append(m.group(1))
        m = re.match(r'duration (-?[\d.]+)', l)
        if m: durs.append(float(m.group(1)))
    t = 0.0; rows = []
    for n_, d_ in zip(names, durs): rows.append((t, n_)); t += d_      # negative durations = out-of-order timestamps
    rows.sort(key=lambda x: (x[0], x[1])); dd = []
    for a, b in rows:
        if dd and abs(dd[-1][0] - a) < 1e-4: dd[-1] = (a, b)
        else: dd.append((a, b))
    json.dump(dd, open(FI, 'w'))
FIDX = json.load(open(FI)); FTS = [a for a, _ in FIDX]

# ------------------------------------------------------------------ real-footage plan (capture-clock seconds)
# (start, end, speed, zoom) ; zoom = (focusX, focusY, z0, z1) or None.  Selected by reviewing the capture contact sheets.
SEG = {
    'login': dict(title='Secure sign-in', sub='Apex sign-in page', segs=[(3, 8, 1, None), (15, 37, 1.6, (0.8, 0.45, 1.0, 1.3))]),
    'dashboard': dict(title='Home dashboard', sub='Platform cards, status and quick search', segs=[(40, 47, 1, None), (56, 76, 1.6, None), (78, 87, 1, None)]),
    'showcase': dict(title='Innovation Showcase', sub='Landing page and 3D ecosystem', segs=[(127, 133, 1, (0.5, 0.5, 1.0, 1.05)), (133, 150, 2.5, None), (776, 800, 1.5, (0.5, 0.4, 1.0, 1.08))]),
    'academia': dict(title='Inspironics Academia', sub='Home, courses, playbooks and tests', segs=[(964, 969.5, 1, None), (972, 979, 1, None), (980, 985, 1, None), (986, 989.5, 1, None)]),
    'limits': dict(title='Current limitations', sub='SlidesVault unavailable / Academia sync failed', segs=[(918, 925, 1, (0.8, 0.32, 1.0, 1.4)), (996, 1008, 1, (0.45, 1.0, 1.0, 1.5))]),
    'signout': dict(title='Session end', sub='Sign out', segs=[(1010.8, 1021.5, 1.4, None)]),
}
scenes = [s for s in nar['scenes'] if not s.get('only_if') or facts.get(s['only_if'])]


def seg_clip(sid, i, s0, s1, speed, zoom):
    out_d = (s1 - s0) / speed; path = f'{WORK}/seg/{sid}_{i}.mp4'; key = f'{s0}|{s1}|{speed}|{zoom}|v3'
    if cached(path, key): return path, out_d
    i0 = max(bisect.bisect_right(FTS, s0) - 1, 0); i1 = bisect.bisect_left(FTS, s1)
    fr = FIDX[i0:i1 + 1]; lines = ['ffconcat version 1.0']
    for j, (t, nm) in enumerate(fr):
        a_ = max(t, s0); b_ = min(fr[j + 1][0], s1) if j + 1 < len(fr) else s1
        if b_ - a_ <= 0: continue
        lines += [f"file '{P(OUT)}/frames/{nm}'", f'duration {b_ - a_:.4f}']
    lines.append(lines[-2]); lst = f'{WORK}/seg/{sid}_{i}.ffconcat'; open(lst, 'w').write('\n'.join(lines))
    vf = f'setpts=PTS/{speed},fps={FPS},scale=1920:1080:flags=bicubic,format=yuv420p'
    if zoom:
        fx, fy, z0, z1 = zoom
        vf += (f",scale=w='trunc(1920*({z0}+({z1}-{z0})*t/{out_d:.3f})/2)*2':h=-2:eval=frame,"
               f"crop=1920:1080:x='(iw-1920)*{fx}':y='(ih-1080)*{fy}',format=yuv420p")
    sh(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', vf, '-t', f'{out_d:.3f}', '-r', str(FPS),
        '-c:v', 'libx264', '-crf', '16', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path + '.tmp.mp4'])
    os.replace(path + '.tmp.mp4', path); stamp(path, key)
    return path, out_d


# ------------------------------------------------------------------ TTS (per phrase => exact timings)
def phrases(text, mx=84):
    out = []
    for s in re.split(r'(?<=[.!?])\s+', text.strip()):
        if len(s) <= mx: out.append(s); continue
        i = s.rfind(',', 0, len(s) // 2 + 25); i = i if i > 20 else s.rfind(' ', 0, len(s) // 2)
        out += [s[:i + 1].strip(), s[i + 1:].strip()]
    return out


if TTS == 'kokoro':
    from kokoro_onnx import Kokoro
    import soundfile as sf
    kk = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))


def wav_len(p):
    with wave.open(p) as w: return w.getnframes() / w.getframerate()


def synth(text, path):
    if TTS == 'kokoro':
        a, sr = kk.create(text, voice=nar['voice']['voice'], speed=nar['voice']['speed'], lang='en-us')
        sf.write(path, a, sr, subtype='PCM_16')
    else:
        sr = 24000; n = int(sr * max(1.2, len(text.split()) / 2.6))
        with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(b'\0\0' * n)


os.makedirs(f'{WORK}/tts_{TTS}', exist_ok=True)
for sc in scenes:
    sc['ph'] = []
    for i, p in enumerate(phrases(sc['text'])):
        wp = f"{WORK}/tts_{TTS}/{sc['id']}_{i}_{hashlib.md5(p.encode()).hexdigest()[:8]}.wav"
        if not os.path.exists(wp): synth(p, wp)
        sc['ph'].append({'text': p, 'wav': wp, 'len': wav_len(wp)})
    sc['narr'] = sum(p['len'] for p in sc['ph']) + 0.18 * (len(sc['ph']) - 1)
if '--tts-only' in sys.argv:
    print('TTS ok:', {s['id']: round(s['narr'], 1) for s in scenes}); sys.exit(0)

# ------------------------------------------------------------------ motion-graphic cards (clearly graphics, not app footage)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
bg = np.zeros((H, W, 3), np.float32)
g = np.clip(1 - np.hypot((xx - W * .3) / 1300, (yy - H * .2) / 800), 0, 1) ** 1.6
for c, v in enumerate((8, 12, 28)): bg[..., c] = v
for c, v in enumerate((20, 55, 120)): bg[..., c] += g * v
BG = bg.clip(0, 255).astype(np.uint8)
rnd = random.Random(7)
NODES = [[rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(-.35, .35), rnd.uniform(-.25, .25), rnd.choice((CY, BL, PU))] for _ in range(72)]


def particles(t):
    im = Image.fromarray(BG).convert('RGBA'); ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    pts = [((n[0] + n[2] * t * 40) % W, (n[1] + n[3] * t * 40) % H, n[4]) for n in NODES]
    for i, a in enumerate(pts):
        for b in pts[i + 1:]:
            dist = math.hypot(a[0] - b[0], a[1] - b[1])
            if dist < 230: d.line([a[:2], b[:2]], fill=(*a[2], int(70 * (1 - dist / 230))), width=2)
    for x, y, c in pts: d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(*c, 170))
    return Image.alpha_composite(im, ov)


def logo(d, cx, cy, s=1.0, a=255):
    p = lambda x, y: (cx + (x - 60) * s, cy + (y - 52) * s)
    d.line([p(60, 6), p(114, 98), p(6, 98), p(60, 6)], fill=(*CY, a), width=int(7 * s), joint='curve')
    d.polygon([p(60, 44), p(84, 86), p(36, 86)], fill=(*CY, a))


def spaced(d, cx, y, text, font, fill, sp):
    w = sum(d.textlength(c, font=font) + sp for c in text) - sp; x = cx - w / 2
    for c in text: d.text((x, y), c, font=font, fill=fill); x += d.textlength(c, font=font) + sp


def A(t, a, b): return float(np.clip((t - a) / (b - a), 0, 1))


def card_frame(kind, t, dur):
    im = particles(t); d = ImageDraw.Draw(im, 'RGBA'); cx = W // 2
    fade = min(A(t, 0, .6), 1 - A(t, dur - .7, dur))
    if kind in ('open', 'close'):
        a = int(255 * A(t, .3, 1.1)); logo(d, cx, 330 - 14 * (1 - A(t, .3, 1.1)), 1.3, a)
        spaced(d, cx, 440 + 20 * (1 - A(t, .8, 1.6)), 'INSPIRONICS APEX', f(92, 'Bold'), (255, 255, 255, int(255 * A(t, .8, 1.6))), 14)
        sub = 'One Workspace. Connected Enterprise Applications.' if kind == 'open' else 'One Front Door. Multiple Enterprise Experiences.'
        d.text((cx, 600), sub, font=f(40, 'Light'), fill=(159, 216, 255, int(255 * A(t, 1.6, 2.4))), anchor='mm')
        d.rectangle([cx - 160, 650, cx + 160, 653], fill=(*PU, int(200 * A(t, 2, 2.8))))
    else:
        d.text((cx, 120), 'A shared entry point to connected applications', font=f(44, 'Medium'), fill=(255, 255, 255, int(255 * A(t, .2, 1))), anchor='mm')
        hub = (cx, 520); apps = [('Innovation Showcase', 460, 330, CY), ('SlidesVault', 1460, 330, BL), ('Inspironics Academia', cx, 780, PU)]
        for i, (n, x, y, c) in enumerate(apps):
            p = A(t, 1.2 + i * .7, 2.2 + i * .7); ex, ey = hub[0] + (x - hub[0]) * p, hub[1] + (y - hub[1]) * p
            d.line([hub, (ex, ey)], fill=(*c, 200), width=5)
            if p > .95:
                bw = 420; d.rounded_rectangle([x - bw / 2, y - 55, x + bw / 2, y + 55], 26, fill=(15, 28, 60, 215), outline=(*c, 255), width=3)
                d.text((x, y), n, font=f(34, 'Medium'), fill=(255, 255, 255, 255), anchor='mm')
        r = 105 + 6 * math.sin(t * 2.2)
        d.ellipse([hub[0] - r - 28, hub[1] - r - 28, hub[0] + r + 28, hub[1] + r + 28], outline=(*CY, 90), width=3)
        d.ellipse([hub[0] - r, hub[1] - r, hub[0] + r, hub[1] + r], fill=(18, 40, 90, 255), outline=(*CY, 255), width=4)
        logo(d, hub[0], hub[1] - 14, .55); d.text((hub[0], hub[1] + 56), 'APEX', font=f(30, 'Bold'), fill=(255, 255, 255, 255), anchor='mm')
        d.text((cx, 1000), 'Illustration', font=f(20, 'Light'), fill=(122, 162, 214, int(200 * A(t, 1, 2))), anchor='mm')
    if fade < 1: im = Image.blend(Image.new('RGBA', (W, H), (5, 8, 18, 255)), im, fade)
    return im.convert('RGB')


def render_card(kind, dur, path):
    key = f'{kind}|{dur:.3f}|v3'
    if cached(path, key): return
    n = int(round(dur * FPS))
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path + '.tmp.mp4'], stdin=subprocess.PIPE)
    for i in range(n): p.stdin.write(card_frame(kind, i / FPS, dur).tobytes())
    p.stdin.close(); assert p.wait() == 0; os.replace(path + '.tmp.mp4', path); stamp(path, key)


def lower_third(title, sub, path):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im, 'RGBA')
    d.rounded_rectangle([60, 800, 860, 920], 22, fill=(8, 14, 32, 215), outline=(*CY, 200), width=2)
    d.rectangle([60, 820, 66, 900], fill=(*CY, 255))
    d.text((92, 832), title, font=f(40, 'Medium'), fill=(255, 255, 255, 255)); d.text((92, 884), sub, font=f(24), fill=(159, 216, 255, 255), anchor='lm')
    im.save(path)


# ------------------------------------------------------------------ build scenes
tl = []; t_acc = 0.0
for sc in scenes:
    sid = sc['id']; vp = f'{WORK}/scene_{sid}.mp4'
    if sid in ('open', 'intro', 'close'):
        dur = max(sc['narr'] + LEAD + TAIL, 6.5 if sid != 'intro' else 12.0)
        render_card({'open': 'open', 'intro': 'explain', 'close': 'close'}[sid], dur, vp)
    else:
        if sid not in SEG: print('skip (no footage plan):', sid); continue
        P = SEG[sid]; clips = [seg_clip(sid, i, *g_) for i, g_ in enumerate(P['segs'])]
        V = sum(d for _, d in clips); want = sc['narr'] + LEAD + TAIL
        pad = max(0.0, want - V); D = V + pad; sc['footage_s'] = round(V, 2); sc['freeze_pad_s'] = round(pad, 2)
        lower_third(P['title'], P['sub'], f'{WORK}/lt_{sid}.png')
        key = f"{[(c, round(d, 2)) for c, d in clips]}|{D:.3f}|{P['title']}|v3"
        if not cached(vp, key):
            lst = f'{WORK}/seg/{sid}_all.txt'; open(lst, 'w').write(''.join(f"file '{P(c)}'\n" for c, _ in clips))
            vf = (f"[0:v]tpad=stop_mode=clone:stop_duration={pad:.3f},format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st={D - 0.35:.3f}:d=0.35[v];"
                  f"[1:v]format=rgba,fade=t=in:st=0.5:d=0.4:alpha=1,fade=t=out:st=4:d=0.4:alpha=1[l];[v][l]overlay=0:0:shortest=0,format=yuv420p[o]")
            sh(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-loop', '1', '-framerate', str(FPS), '-t', f'{D:.3f}', '-i', f'{WORK}/lt_{sid}.png',
                '-filter_complex', vf, '-map', '[o]', '-t', f'{D:.3f}', '-r', str(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', vp + '.tmp.mp4'])
            os.replace(vp + '.tmp.mp4', vp); stamp(vp, key)
    sc['start'] = t_acc
    sc['dur'] = float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vp]).stdout)
    t_acc += sc['dur']; tl.append((sc, vp))

lst = f'{WORK}/concat.txt'; open(lst, 'w').write(''.join(f"file '{P(v)}'\n" for _, v in tl))
sh(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', f'{WORK}/picture.mp4'])

# ------------------------------------------------------------------ audio + subtitles from REAL phrase timings
ins, fl, cues, n_in = [], [], [], 0


def ts(t): return f"{int(t // 3600):02}:{int(t % 3600 // 60):02}:{int(t % 60):02},{int(round((t - int(t)) * 1000)):03}"


def wrap(s, n=42):
    cur, out = '', []
    for w in s.split():
        if len(cur) + len(w) + 1 > n and cur: out.append(cur); cur = w
        else: cur = (cur + ' ' + w).strip()
    return '\n'.join(out + [cur])


for sc, _ in tl:
    t = sc['start'] + LEAD
    for p in sc['ph']:
        ins += ['-i', p['wav']]; fl.append(f"[{n_in}:a]aresample=48000,adelay={int(t * 1000)}|{int(t * 1000)}[a{n_in}]"); n_in += 1
        cues.append((t, t + p['len'], p['text'])); t += p['len'] + 0.18
srt = ''.join(f"{i + 1}\n{ts(a)} --> {ts(b)}\n{wrap(x)}\n\n" for i, (a, b, x) in enumerate(cues))
assert all(cues[i][1] <= cues[i + 1][0] for i in range(len(cues) - 1)), 'overlapping subtitles'
open(f'{WORK}/subs.srt', 'w', encoding='utf-8').write(srt)
mix = ''.join(f'[a{i}]' for i in range(n_in)) + f"amix=inputs={n_in}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur={t_acc:.3f}[aout]"
sh(['ffmpeg', '-y', '-loglevel', 'error'] + ins + ['-filter_complex', ';'.join(fl + [mix]), '-map', '[aout]', '-t', f'{t_acc:.3f}', '-ar', '48000', '-ac', '1', f'{WORK}/voiceover.wav'])

# ------------------------------------------------------------------ final renders
FIN = f'{DEST}/APEX_Product_Demo.mp4'; SUB = f'{DEST}/APEX_Product_Demo_Subtitled.mp4'
if not os.path.exists(FIN) or os.path.getmtime(FIN) < os.path.getmtime(f'{WORK}/voiceover.wav'):
    sh(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{WORK}/picture.mp4', '-i', f'{WORK}/voiceover.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', FIN + '.tmp.mp4']); os.replace(FIN + '.tmp.mp4', FIN)
shutil.copy(f'{WORK}/subs.srt', f'{DEST}/APEX_Demo_Subtitles.srt')
if TTS == 'kokoro': shutil.copy(f'{WORK}/voiceover.wav', f'{DEST}/APEX_Demo_Voiceover.wav')
open(f'{DEST}/APEX_Demo_Narration.txt', 'w', encoding='utf-8').write(
    'INSPIRONICS APEX - PRODUCT DEMONSTRATION NARRATION (as spoken)\n\n' + '\n\n'.join(f"[{s['id'].upper()}  {ts(s['start'])[:8]}]\n" + ' '.join(p['text'] for p in s['ph']) for s, _ in tl) + '\n')
json.dump({'scenes': [{k: v for k, v in s.items() if k != 'ph'} | {'phrases': [p['text'] for p in s['ph']]} for s, _ in tl],
           'facts': {k: v for k, v in facts.items() if k != 'dashboardText'}, 'tts': TTS, 'total_seconds': t_acc},
          open(f'{WORK}/timeline.json', 'w'), indent=1)
os.makedirs(f'{DEST}/screenshots', exist_ok=True)
print(f'STAGE1 OK  {FIN}  {t_acc:.1f}s  scenes={[s["id"] for s, _ in tl]}  (run burn step next: --burn)')
if '--burn' in sys.argv or True:
    if not os.path.exists(SUB) or os.path.getmtime(SUB) < os.path.getmtime(FIN):
        style = f"FontName={SUB_FONT},FontSize=15,PrimaryColour=&HFFFFFF&,OutlineColour=&H20000000&,BackColour=&H99000000&,BorderStyle=4,Outline=1,Shadow=0,MarginV=36,Alignment=2"
        sh(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.abspath(FIN), '-vf', f"subtitles=subs.srt:force_style='{style}'", '-c:v', 'libx264', '-crf', '19',
            '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', os.path.abspath(SUB) + '.tmp.mp4'], cwd=WORK)
        os.replace(SUB + '.tmp.mp4', SUB)
    print('OK', SUB)
