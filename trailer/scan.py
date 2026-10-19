import sys,os,json,subprocess,numpy as np
vid=sys.argv[1];W,H=(160,90) if len(sys.argv)<3 else (108,135)
if len(sys.argv)>3 and not sys.argv[2].endswith('.json'): sys.argv[2]=os.path.join(os.path.dirname(os.path.abspath(__file__)),'edl.json')
E=json.load(open(sys.argv[2] if len(sys.argv)>3 else os.path.join(os.path.dirname(os.path.abspath(__file__)),'edl.json')))
cuts=[];t=0.0
for s in E['segments']:cuts.append((round(t,2),s['id'],s.get('act')));t+=s['d']
raw=subprocess.run(['ffmpeg','-v','error','-i',vid,'-vf',f'scale={W}:{H}','-pix_fmt','gray','-f','rawvideo','-'],capture_output=True).stdout
fr=np.frombuffer(raw,np.uint8).reshape(-1,H,W).astype(np.int16);n=len(fr);fps=60
print('frames',n,'=',n/fps,'s')
mean=fr.reshape(n,-1).mean(1);diff=np.abs(np.diff(fr,axis=0)).reshape(n-1,-1).mean(1)
cutf=[int(round(c[0]*fps)) for c in cuts]
def near_cut(i):return any(abs(i-c)<=1 for c in cutf)
spikes=[(i+1,round(float(d),1)) for i,d in enumerate(diff) if d>22 and not near_cut(i+1)]
print('spikes not at cuts:',spikes[:40],len(spikes))
dark=[i for i,m in enumerate(mean) if m<16]
# group dark frames into runs
runs=[];
for i in dark:
    if runs and i==runs[-1][1]+1:runs[-1][1]=i
    else:runs.append([i,i])
print('dark runs (s):',[(round(a/fps,2),round(b/fps,2)) for a,b in runs])
dups=[i+1 for i,d in enumerate(diff) if d<0.05]
runs=[]
for i in dups:
    if runs and i==runs[-1][1]+1:runs[-1][1]=i
    else:runs.append([i,i])
print('still runs >=2 frames (s):',[(round(a/fps,2),round(b/fps,2)) for a,b in runs if b-a>=1][:60])
print('single dup frames:',len([r for r in runs if r[1]==r[0]]))
# per-segment motion summary
for k,(t0,sid,act) in enumerate(cuts):
    a=int(round(t0*fps));b=int(round((cuts[k+1][0] if k+1<len(cuts) else n/fps)*fps))
    d=diff[a:b-1];print(f'{sid:>3} {t0:6.2f} {act:8s} mean-diff {d.mean():5.1f} max {d.max():5.1f} at +{(d.argmax())/fps:.2f}s  dups {(d<0.05).sum()}  lum {mean[a:b].mean():5.1f}')
