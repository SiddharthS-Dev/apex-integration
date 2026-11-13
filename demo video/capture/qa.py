#!/usr/bin/env python3
"""Automated QA of Apex_Demo_Final: probes, black/frozen/silence detection, loudness, SRT sanity, contact sheets (qa/)."""
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, 'Apex_Demo_Final'); QA = os.path.join(DEST, 'qa'); os.makedirs(QA, exist_ok=True)
FIN = os.path.join(DEST, 'APEX_Product_Demo.mp4'); SUB = os.path.join(DEST, 'APEX_Product_Demo_Subtitled.mp4')
run = lambda c: subprocess.run(c, capture_output=True, text=True)
rep = {}
for name, p in (('final', FIN), ('subtitled', SUB)):
    if not os.path.exists(p): rep[name] = 'MISSING'; continue
    j = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,sample_rate,channels,duration:format=duration,size', '-of', 'json', p]).stdout)
    rep[name] = {'streams': j['streams'], 'format': j['format']}
if os.path.exists(FIN):
    e = run(['ffmpeg', '-hide_banner', '-i', FIN, '-vf', 'blackdetect=d=0.6:pix_th=0.06,freezedetect=n=-60dB:d=4', '-af', 'silencedetect=n=-45dB:d=4,ebur128=peak=true', '-f', 'null', '-']).stderr
    rep['black_intervals'] = re.findall(r'black_start:([\d.]+).*?black_end:([\d.]+)', e)
    rep['freeze_events'] = re.findall(r'freeze_(start|duration|end): ([\d.]+)', e)
    rep['silence_events'] = re.findall(r'silence_(start|end): ([\d.]+)', e)
    m = re.search(r'Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS', e); rep['loudness_LUFS'] = m.group(1) if m else None
    m = re.search(r'True peak:\s+Peak:\s+(-?[\d.]+) dBFS', e); rep['true_peak_dBFS'] = m.group(1) if m else None
    dur = float(rep['final']['format']['duration'])
    n = int(dur // 4) + 1; cols = 6; w, h = 320, 180
    sheet = Image.new('RGB', (cols * w, ((n + cols - 1) // cols) * h))
    for i in range(n):
        t = min(i * 4 + 1, dur - 0.2); tmp = os.path.join(QA, '_f.png')
        run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', FIN, '-frames:v', '1', '-vf', f'scale={w}:{h}', tmp])
        if os.path.exists(tmp):
            im = Image.open(tmp).convert('RGB'); d = ImageDraw.Draw(im); d.rectangle([0, 0, 58, 14], fill=(0, 0, 0)); d.text((3, 1), f'{t:.0f}s', fill=(255, 255, 0))
            sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    sheet.save(os.path.join(QA, 'contact_sheet.jpg'), quality=85)
    for t in (3, 20, 60, 100, 130): pass
srt = os.path.join(DEST, 'APEX_Demo_Subtitles.srt')
if os.path.exists(srt):
    cues = re.findall(r'(\d+)\n([\d:,]+) --> ([\d:,]+)\n(.*?)\n\n', open(srt, encoding='utf-8').read() + '\n', re.S)
    sec = lambda s: sum(float(x.replace(',', '.')) * k for x, k in zip(s.split(':'), (3600, 60, 1)))
    rep['srt'] = {'cues': len(cues), 'overlaps': sum(1 for a, b in zip(cues, cues[1:]) if sec(a[2]) > sec(b[1])), 'max_lines': max(c[3].count('\n') + 1 for c in cues)}
json.dump(rep, open(os.path.join(QA, 'qa_report.json'), 'w'), indent=1)
print(json.dumps({k: v for k, v in rep.items() if k not in ('final', 'subtitled')}, indent=1)); print('QA written to', QA)
