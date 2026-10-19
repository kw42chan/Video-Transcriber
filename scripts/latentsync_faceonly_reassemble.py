"""Usage: python scripts/latentsync_faceonly_reassemble.py <pair_dir> <ls_faceonly.mp4> <spans e.g. 0-371,498-863,990-1199> <out.mp4>
Spans are inclusive source-frame ranges (at the pair's fps) that were joined for the face-only LatentSync input.
Writes <out.mp4> (dubbed audio from <pair_dir>/audio.wav) and <out>_timeline.json.

Rebuild the full pair timeline: LatentSync face-only output (25 fps, 384 frames) for face spans,
original frames for faceless shots, safety-trim frames, and the LatentSync-truncated tail. Time-based mapping
k = floor(jj/60*25) (keeps LatentSync's own mouth/audio alignment); if the LS frame's content belongs to a
different shot the original frame is used: (a) hard cut inside a span (non-mouth score > THR=100; LS's ~58 ms
content lag shows the pre-cut shot for ~3 frames), or (b) at a join point, LS content index (k/25*60 - LAG) still lies in the
previous span. Gradual zoom transitions keep the LS frame (natural lag, not a glitch)."""
import cv2, numpy as np, subprocess, json
import sys
D, LS_PATH, SPAN_ARG, OUT = sys.argv[1:5]
SPANS=[tuple(int(v) for v in s.split('-')) for s in SPAN_ARG.split(',')]; THR=100; LAG=3.5  # LS content lag in 60fps frames (measured)
def frames(p):
    c=cv2.VideoCapture(p); L=[]
    while True:
        ok,f=c.read()
        if not ok: break
        L.append(f)
    return L
O=frames(f'{D}/video.mp4'); LS_FPS=cv2.VideoCapture(LS_PATH).get(cv2.CAP_PROP_FPS); FPS=round(cv2.VideoCapture(f'{D}/video.mp4').get(cv2.CAP_PROP_FPS)); L=frames(LS_PATH)
sm=lambda f: cv2.resize(f,(135,240)).astype(float)
def score(a,b): a,b=sm(a),sm(b); return np.abs(a[:90]-b[:90]).mean()+np.abs(a[170:]-b[170:]).mean()
mp={}; jj=0; span_start={}
for a,b in SPANS:
    st=jj
    for j in range(a,b+1): mp[j]=jj; span_start[j]=st; jj+=1
src=[]; H,W=O[0].shape[:2]
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
   '-i',f'{D}/audio.wav','-map','0:v','-map','1:a','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',
   '-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',OUT],stdin=subprocess.PIPE)
for j in range(len(O)):
    tag='orig-faceless'
    if j in mp:
        k=int(mp[j]/FPS*LS_FPS+1e-9)
        if k>=len(L): f=O[j]; tag='orig-LS-truncated-tail'
        else:
            s=score(L[k],O[j]); content=k/LS_FPS*FPS-LAG
            if span_start[j]>0 and content < span_start[j]-0.5: f=O[j]; tag='orig-join-lag'
            elif s>THR: f=O[j]; tag='orig-hardcut-lag'
            else: f=L[k]; tag='latentsync'
    else: f=O[j]
    if j not in mp and any(a-3<=j<a or b<j<=b+3 for a,b in SPANS): tag='orig-safety-trim'
    if f.shape[:2]!=(H,W): f=cv2.resize(f,(W,H))
    p.stdin.write(f.tobytes()); src.append(tag)
p.stdin.close(); p.wait()
from itertools import groupby
runs=[]; i=0
for t,g in groupby(src):
    n=len(list(g)); runs.append({'from_s':round(i/FPS,3),'to_s':round((i+n)/FPS,3),'frames':n,'source':t}); i+=n
json.dump(runs,open(OUT.replace('.mp4','')+'_timeline.json','w'),indent=1)
for r in runs: print(r)
