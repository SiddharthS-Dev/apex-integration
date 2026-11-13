"""python3 build_srt.py [out/marks.json] -> Apex_Demo.srt (re-run after every capture; timings follow the real scene marks)."""
import json, re, sys, os
here = os.path.dirname(os.path.abspath(__file__))
mp = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'out', 'marks.json')
marks = {m['name']: m['t'] for m in json.load(open(mp))['marks']} if os.path.exists(mp) else {}
est = {'S1 intro':0.5,'S2 login':7.5,'S3 dashboard':30,'S4 showcase':62,'S5 vault':100,'S6 academia':135,'S8 finale':165,'S8 outro':180}
WPS = 2.55  # words/second, natural pace
def ts(t):
    h=int(t//3600); m=int(t%3600//60); s=t%60; return f"{h:02}:{m:02}:{int(s):02},{int(round((s-int(s))*1000)):03}"
def wrap(s, n=42):
    w=s.split(); lines=[]; cur=''
    for x in w:
        if len(cur)+len(x)+1>n and cur: lines.append(cur); cur=x
        else: cur=(cur+' '+x).strip()
    lines.append(cur); return '\n'.join(lines)
out=[]; i=1; src='real marks' if marks else 'ESTIMATED marks'
for sc in json.load(open(os.path.join(here,'narration.json'))):
    t = (marks.get(sc['mark'], est[sc['mark']])) + 0.8
    sents = re.split(r'(?<=[.!?])\s+', sc['text'])
    for s in sents:
        chunks=[s]
        if len(s)>84:  # keep each cue to two lines
            half=s.rfind(',',0,len(s)//2+20); half = half if half>20 else s.rfind(' ',0,len(s)//2)
            chunks=[s[:half+1].strip(), s[half+1:].strip()]
        for c in chunks:
            d=max(1.6,len(c.split())/WPS)
            out.append(f"{i}\n{ts(t)} --> {ts(t+d)}\n{wrap(c)}\n"); i+=1; t+=d+0.15
open(os.path.join(here,'Apex_Demo.srt'),'w',encoding='utf-8').write('\n'.join(out))
print(f'{i-1} cues written using {src}')
