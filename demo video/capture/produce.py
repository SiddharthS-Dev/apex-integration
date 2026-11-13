#!/usr/bin/env python3
"""
Apex demo producer.  Inputs: out/ (from capture.mjs), narration_final.json.
Usage:  python3 produce.py [--dest DIR] [--tts kokoro|dummy] [--model-dir DIR]
 - 'dummy' (silent timing) exists ONLY to test the pipeline; its output is never a deliverable.
Steps: assemble screen track -> TTS per phrase (real durations) -> render motion-graphic cards ->
       cut/zoom/lower-third each scene -> concat -> mix audio -> SRT from real timings -> burn subs.
"""
import json, os, re, subprocess, sys, shutil, wave, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
DEST = arg('--dest', os.path.join(HERE, '..', 'Apex_Demo_Final'))
TTS = arg('--tts', 'kokoro'); MODEL_DIR = arg('--model-dir', os.path.join(HERE, 'voice-model'))
OUT = arg('--out', os.path.join(HERE, 'out')); WORK = os.path.join(HERE, 'work')
W, H, FPS = 1920, 1080, 30
FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-%s.ttf'
CY, BL, PU = (34, 211, 238), (59, 130, 246), (168, 85, 247)
def sh(cmd):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if r.returncode: raise SystemExit('COMMAND FAILED:\n' + (cmd if isinstance(cmd, str) else ' '.join(cmd)) + '\n' + r.stderr[-1500:])
    return r
from functools import lru_cache
@lru_cache(None)
def f(sz, w='Regular'): return ImageFont.truetype(FONT % w, sz)
os.makedirs(WORK, exist_ok=True)

marks = {m['name']: m['t'] for m in json.load(open(f'{OUT}/marks.json'))['marks']} if os.path.exists(f'{OUT}/marks.json') else {}
facts = json.load(open(f'{OUT}/facts.json')) if os.path.exists(f'{OUT}/facts.json') else {}
issues = json.load(open(f'{OUT}/issues.json')) if os.path.exists(f'{OUT}/issues.json') else []
steps = json.load(open(f'{OUT}/steps.json')) if os.path.exists(f'{OUT}/steps.json') else []
facts['signoutOk'] = any(s.get('label') == 'sign out' and s.get('ok') for s in steps)
nar = json.load(open(os.path.join(HERE, 'narration_final.json')))

# ---------------------------------------------------------------- screen track
screen = os.path.join(OUT, 'screen_1080p.mp4')
if not os.path.exists(screen):
    sh(f'ffmpeg -y -f concat -safe 0 -i "{OUT}/frames.ffconcat" -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p "{screen}.tmp.mp4" && mv "{screen}.tmp.mp4" "{screen}"')
SEG = {  # id: (start mark, end mark, lower-third title, subtitle)
 'login': ('S2 login', 'S3 dashboard', 'Secure sign-in', 'Apex sign-in page'),
 'dashboard': ('S3 dashboard', 'S4 showcase', 'Home dashboard', 'Applications, status and activity'),
 'showcase': ('S4 showcase', 'S5 vault', 'Innovation Showcase', 'Blueprint gallery'),
 'vault': ('S5 vault', 'S7 unified', 'SlidesVault', 'Presentation library'),
 'unified': ('S7 unified', 'S6 academia', 'One front door', 'Back to the Apex dashboard'),
 'limits': ('S8 limits', 'S9 signout', 'Current limitation', 'Academia synchronization'),
 'signout': ('S9 signout', 'END', 'Session end', 'Sign out'),
}
scenes = [s for s in nar['scenes'] if not s.get('only_if') or facts.get(s['only_if'])]

# ---------------------------------------------------------------- TTS (per phrase => exact timings)
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
def synth(text, path):
    if TTS == 'kokoro':
        a, sr = kk.create(text, voice=nar['voice']['voice'], speed=nar['voice']['speed'], lang='en-us')
        sf.write(path, a, sr)
def wav_len(p):
    with wave.open(p) as w: return w.getnframes() / w.getframerate()
def synth_any(text, path):
    if TTS == 'kokoro': return synth(text, path)
    sr = 24000; n = int(sr * max(1.2, len(text.split()) / 2.6))
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(b'\0\0' * n)
os.makedirs(f'{WORK}/tts_{TTS}', exist_ok=True)
for sc in scenes:
    sc['ph'] = []
    for i, p in enumerate(phrases(sc['text'])):
        wp = f"{WORK}/tts_{TTS}/{sc['id']}_{i}.wav"
        if not os.path.exists(wp): synth_any(p, wp)
        sc['ph'].append({'text': p, 'wav': wp, 'len': wav_len(wp)})
    sc['narr'] = sum(p['len'] for p in sc['ph']) + 0.18 * (len(sc['ph']) - 1)

# ---------------------------------------------------------------- motion graphics cards
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
bg = np.zeros((H, W, 3), np.float32)
g = np.clip(1 - np.hypot((xx - W * .3) / 1300, (yy - H * .2) / 800), 0, 1) ** 1.6
for c, v in enumerate((8, 12, 28)): bg[..., c] = v
for c, v in enumerate((20, 55, 120)): bg[..., c] += g * v
BG = bg.clip(0, 255).astype(np.uint8)
rnd = random.Random(7); NODES = [[rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(-.35, .35), rnd.uniform(-.25, .25), rnd.choice((CY, BL, PU))] for _ in range(72)]
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
        ta = int(255 * A(t, 1.6, 2.4)); d.text((cx, 600), sub, font=f(40, 'Light'), fill=(159, 216, 255, ta), anchor='mm')
        d.rectangle([cx - 160, 650, cx + 160, 653], fill=(*PU, int(200 * A(t, 2, 2.8))))
    else:  # explainer: hub and three connected applications
        d.text((cx, 120), 'A shared entry point to connected applications', font=f(44, 'Medium'), fill=(255, 255, 255, int(255 * A(t, .2, 1))), anchor='mm')
        hub = (cx, 520); apps = [('Innovation Showcase', 460, 330, CY), ('SlidesVault', 1460, 330, BL), ('Inspironics Academia', cx, 780, PU)]
        for i, (n, x, y, c) in enumerate(apps):
            p = A(t, 1.2 + i * .7, 2.2 + i * .7)
            ex, ey = hub[0] + (x - hub[0]) * p, hub[1] + (y - hub[1]) * p
            d.line([hub, (ex, ey)], fill=(*c, 200), width=5)
            if p > .95:
                bw = 420; d.rounded_rectangle([x - bw / 2, y - 55, x + bw / 2, y + 55], 26, fill=(15, 28, 60, 215), outline=(*c, 255), width=3)
                d.text((x, y), n, font=f(34, 'Medium'), fill=(255, 255, 255, 255), anchor='mm')
        r = 105 + 6 * math.sin(t * 2.2); d.ellipse([hub[0] - r - 28, hub[1] - r - 28, hub[0] + r + 28, hub[1] + r + 28], outline=(*CY, 90), width=3)
        d.ellipse([hub[0] - r, hub[1] - r, hub[0] + r, hub[1] + r], fill=(18, 40, 90, 255), outline=(*CY, 255), width=4)
        logo(d, hub[0], hub[1] - 14, .55); d.text((hub[0], hub[1] + 56), 'APEX', font=f(30, 'Bold'), fill=(255, 255, 255, 255), anchor='mm')
    if fade < 1: im = Image.blend(Image.new('RGBA', (W, H), (5, 8, 18, 255)), im, fade)
    return im.convert('RGB')
def cached(path, key):
    k = path + '.key'
    return os.path.exists(path) and os.path.exists(k) and open(k).read() == key
def stamp(path, key): open(path + '.key', 'w').write(key)
def render_card(kind, dur, path):
    if cached(path, f'{kind}|{dur:.3f}|v2'): return
    n = int(round(dur * FPS))
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path + '.tmp.mp4'], stdin=subprocess.PIPE)
    for i in range(n): p.stdin.write(card_frame(kind, i / FPS, dur).tobytes())
    p.stdin.close(); assert p.wait() == 0; os.replace(path + '.tmp.mp4', path); stamp(path, f'{kind}|{dur:.3f}|v2')
def lower_third(title, sub, path):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im, 'RGBA')
    d.rounded_rectangle([60, 800, 760, 920], 22, fill=(8, 14, 32, 215), outline=(*CY, 200), width=2)
    d.rectangle([60, 820, 66, 900], fill=(*CY, 255))
    d.text((92, 832), title, font=f(40, 'Medium'), fill=(255, 255, 255, 255)); d.text((92, 880), sub, font=f(24), fill=(159, 216, 255, 255), anchor='lm')
    im.save(path)

# ---------------------------------------------------------------- build scenes
LEAD, TAIL = .6, .9
tl = []  # timeline: (scene, video path, start offset)
t_acc = 0.0
for sc in scenes:
    sid = sc['id']; vp = f'{WORK}/scene_{sid}.mp4'
    if sid in ('open', 'intro', 'close'):
        dur = max(sc['narr'] + LEAD + TAIL, 6.0 if sid != 'intro' else 12.0)
        render_card({'open': 'open', 'intro': 'explain', 'close': 'close'}[sid], dur, vp)
    else:
        if sid not in SEG or SEG[sid][0] not in marks or SEG[sid][1] not in marks: print('skip (no capture marks):', sid); continue
        a, b, title, sub = SEG[sid]; s0, s1 = marks[a], marks[b]; V = s1 - s0
        want = sc['narr'] + LEAD + TAIL
        D = max(want, V / 1.6); speed = V / D if V > D else 1.0; pad = max(0, D - V / speed)
        D = V / speed + pad; sc['speed'] = round(speed, 2); lower_third(title, sub, f'{WORK}/lt_{sid}.png')
        vf = (f"[0:v]trim=start={s0:.3f}:end={s1:.3f},setpts=(PTS-STARTPTS)/{speed:.4f},tpad=stop_mode=clone:stop_duration={pad:.3f},fps={FPS},"
              f"scale=w='1920*(1+0.035*t/{D:.3f})':h=-2:eval=frame,crop=1920:1080,format=yuv420p,"
              f"fade=t=in:st=0:d=0.35,fade=t=out:st={D - 0.35:.3f}:d=0.35[v];"
              f"[1:v]format=rgba,fade=t=in:st=0.5:d=0.4:alpha=1,fade=t=out:st=4:d=0.4:alpha=1[l];[v][l]overlay=0:0:shortest=0,format=yuv420p[o]")
        key = f'{s0:.2f}|{s1:.2f}|{D:.3f}|{speed:.4f}|{title}|v2'
        if not cached(vp, key):
            sh(['ffmpeg', '-y', '-loglevel', 'error', '-threads', '2', '-i', screen, '-loop', '1', '-framerate', str(FPS), '-t', f'{D:.3f}', '-i', f'{WORK}/lt_{sid}.png',
            '-filter_complex', vf, '-map', '[o]', '-t', f'{D:.3f}', '-r', str(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', vp + '.tmp.mp4'])
            os.replace(vp + '.tmp.mp4', vp); stamp(vp, key)
    sc['start'] = t_acc; sc['dur'] = float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vp]).stdout); t_acc += sc['dur']; tl.append((sc, vp))
os.makedirs(DEST, exist_ok=True)
lst = f'{WORK}/concat.txt'; open(lst, 'w').write(''.join(f"file '{v}'\n" for _, v in tl))
sh(f'ffmpeg -y -loglevel error -f concat -safe 0 -i "{lst}" -c copy "{WORK}/picture.mp4"')

# ---------------------------------------------------------------- audio + subtitles from REAL phrase timings
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
open(f'{WORK}/Apex_Demo.srt', 'w', encoding='utf-8').write(srt)
mix = ''.join(f'[a{i}]' for i in range(n_in)) + f"amix=inputs={n_in}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur={t_acc:.3f}[aout]"
sh(['ffmpeg', '-y', '-loglevel', 'error'] + ins + ['-filter_complex', ';'.join(fl + [mix]), '-map', '[aout]', '-t', f'{t_acc:.3f}', '-ar', '48000', '-ac', '1', f'{WORK}/voiceover.wav'])

# ---------------------------------------------------------------- final renders
FIN = f'{DEST}/Apex_Demo_Final.mp4'; SUB = f'{DEST}/Apex_Demo_Subtitled.mp4'
sh(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{WORK}/picture.mp4', '-i', f'{WORK}/voiceover.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', FIN + '.tmp.mp4']); os.replace(FIN + '.tmp.mp4', FIN)
style = "FontName=Poppins,FontSize=15,PrimaryColour=&HFFFFFF&,OutlineColour=&H20000000&,BackColour=&H99000000&,BorderStyle=4,Outline=1,Shadow=0,MarginV=36,Alignment=2"
shutil.copy(f'{WORK}/Apex_Demo.srt', f'{DEST}/Apex_Demo.srt')
sh(['ffmpeg', '-y', '-loglevel', 'error', '-i', FIN, '-vf', f"subtitles={WORK}/Apex_Demo.srt:force_style='{style}'", '-c:v', 'libx264', '-crf', '19', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', SUB + '.tmp.mp4']); os.replace(SUB + '.tmp.mp4', SUB)
if TTS == 'kokoro': shutil.copy(f'{WORK}/voiceover.wav', f'{DEST}/voiceover.wav')
json.dump({'scenes': [{k: v for k, v in s.items() if k not in ('ph',)} | {'phrases': [p['text'] for p in s['ph']]} for s, _ in tl], 'facts': {k: v for k, v in facts.items() if k != 'dashboardText'}, 'tts': TTS, 'total_seconds': t_acc},
          open(f'{DEST}/narration_final.json', 'w'), indent=1)
os.makedirs(f'{DEST}/screenshots', exist_ok=True)
if os.path.isdir(f'{OUT}/screenshots'):
    for n in os.listdir(f'{OUT}/screenshots'): shutil.copy(f'{OUT}/screenshots/{n}', f'{DEST}/screenshots/{n}')
print(f'OK  {FIN}  {t_acc:.1f}s  tts={TTS}  scenes={[s["id"] for s,_ in tl]}')
