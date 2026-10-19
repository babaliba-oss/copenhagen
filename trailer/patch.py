"""Patch a brief near-camera object out of a cut: frames whose bottom-left region deviates from their neighbours get that
region replaced by a time-blend of the nearest clean frames (the region is plain asphalt sliding slowly)."""
import sys,subprocess,numpy as np
src,dst=sys.argv[1],sys.argv[2];W,H=1920,1080
raw=subprocess.run(['ffmpeg','-v','error','-i',src,'-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True).stdout
fr=np.frombuffer(raw,np.uint8).reshape(-1,H,W,3).copy();n=len(fr);print('frames',n)
X0,X1,Y0,Y1=482,1438,720,1080   # region: bottom-left of the centre crop (crop x 482..1438)
reg=fr[:,Y0:Y1,X0:X1].astype(np.int16)
# deviation of each frame's region from the median of a +-8 frame window (excluding itself)
dev=np.zeros(n)
for i in range(n):
    lo,hi=max(0,i-8),min(n,i+9);idx=[j for j in range(lo,hi) if j!=i]
    med=np.median(reg[idx],axis=0);dev[i]=np.abs(reg[i]-med).mean()
thr=max(3.5,np.percentile(dev,80)*1.8);bad=sorted({j for i in range(n) if dev[i]>thr for j in range(i-3,i+4) if 0<=j<n})  # three frames either side too (the slivers as it enters and leaves)
print('deviation p50/p80/max',np.percentile(dev,50).round(2),np.percentile(dev,80).round(2),dev.max().round(2),'thr',round(thr,2));print('bad frames',bad,[round(i/60,3) for i in bad])
# group runs, patch each run from the clean frames just outside it
runs=[]
for i in bad:
    if runs and i<=runs[-1][1]+2:runs[-1][1]=i
    else:runs.append([i,i])
for a,b in runs:
    a0=max(0,a-1);b0=min(n-1,b+1)
    A=fr[a0,Y0:Y1,X0:X1].astype(np.float32);B=fr[b0,Y0:Y1,X0:X1].astype(np.float32)
    for i in range(a,b+1):
        t=(i-a0)/max(1,(b0-a0));fr[i,Y0:Y1,X0:X1]=(A*(1-t)+B*t).round().clip(0,255).astype(np.uint8)
    print('patched',a,'..',b,'from',a0,b0)
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','60','-i','-','-c:v','libx264','-preset','medium','-crf','14','-pix_fmt','yuv420p',dst],stdin=subprocess.PIPE)
p.stdin.write(fr.tobytes());p.stdin.close();p.wait();print('wrote',dst)
