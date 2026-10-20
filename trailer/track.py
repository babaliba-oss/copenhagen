#!/usr/bin/env python3
"""Fits a licensed track to the edit: "Rock Me Now" by Pufino (freetouse.com), 146 BPM, cut at bar lines so its
sections land on the trailer's cuts.
  python3 track.py in.mp3 out.wav total_seconds
The track's grid (measured: autocorrelation of the spectral flux, downbeats from the low band): bar 0 at 0.17 s,
1.6438 s a bar. Sections: intro bars 0-4 (a pickup fill in bar 4), groove A bars 5-12 (the band slams in half a beat
after bar 5's downbeat), breakdown B 13-19, full C 20-43, breakdown D 44-50, full E 51-74, stop at bar 75.
Used, in order: intro + A, A's second phrase again (bars 9-12), B's last five bars, C's first 19 bars, the song's
last two bars and its stop. Two slightly different speeds (1.9% and 0.9% slower, a step of 1% at one join in the
quiet breakdown) put the slam on the cut to today (8.4 s), bar 20 on the cut to 1760 (36.6 s) and the stop on the
end card (71.4 s); every join is a 20 ms equal-power crossfade centred on a bar line.
"""
import sys, subprocess, numpy as np, wave
SRC, OUT, TOTAL = sys.argv[1], sys.argv[2], float(sys.argv[3])
SR = 48000
BPM, PHASE = 146.0, 0.17; BEAT0 = 60 / BPM; BAR0 = 4 * BEAT0
DROP, HIT = 8.4, 36.6                         # the cut to today, the cut to 1760
S2 = ((HIT - DROP) - 5 * 0) / 17 / BAR0       # placeholder, set below
def decode(stretch):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', SRC, '-af', f'atempo={1 / stretch:.6f}', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
# speeds: B (5 bars) and everything after run at S2, chosen so B ends on the 1760 cut 17 bars after the drop would at
# one speed; the intro, A and A2 run at S1 so that the slam (bar 5 + half a beat) lands on the drop and A+A2 (12 bars)
# end exactly where B begins
S2 = (HIT - DROP) / 17 / BAR0                                    # 1.0091
b_start = HIT - 5 * BAR0 * S2                                    # 28.306: where B begins
S1 = (b_start - DROP) / (12 * BAR0 - .5 * BEAT0)                 # 1.0194: 12 bars less the half beat before the slam
a1, a2 = decode(S1), decode(S2)
bar_at = lambda k, s: (PHASE + k * BAR0) * s
n = int(TOTAL * SR); out = np.zeros((n, 2)); XF = int(.02 * SR)
def place(a, t0, t1, at):
    """file seconds t0..t1 of `a` laid at `at` seconds of the output, 10 ms either side fading across the joins"""
    i0 = int(round(t0 * SR)) - XF // 2; i1 = int(round(t1 * SR)) + XF // 2
    seg = a[max(0, i0):i1].copy(); lead = max(0, i0) - i0
    r = np.linspace(0, 1, XF)[:, None]; seg[:XF] *= np.sin(r * np.pi / 2); seg[-XF:] *= np.cos(r * np.pi / 2)
    j0 = int(round(at * SR)) - XF // 2 + lead
    if j0 < 0: seg = seg[-j0:]; j0 = 0
    j1 = min(n, j0 + len(seg)); out[j0:j1] += seg[:j1 - j0]
slam = DROP - .5 * BEAT0 * S1                 # bar 5's downbeat lands half a beat before the slam
t = slam - bar_at(5, S1) + bar_at(0, S1)      # where bar 0 lands
for k0, k1 in [(0, 5), (5, 13), (9, 13)]:
    place(a1, bar_at(k0, S1), bar_at(k1, S1), t); t += (k1 - k0) * BAR0 * S1
assert abs(t - b_start) < 1e-6
for k0, k1 in [(15, 20), (20, 39), (73, 75)]:
    place(a2, bar_at(k0, S2), bar_at(k1, S2), t); t += (k1 - k0) * BAR0 * S2
stop = t
tail0 = bar_at(75, S2); tail = a2[int(round(tail0 * SR)):int(round((tail0 + 3.0) * SR))].copy()
tail *= np.linspace(1, 0, len(tail))[:, None] ** .5; r = np.linspace(0, 1, XF)[:, None]; tail[:XF] *= np.sin(r * np.pi / 2)
j0 = int(round(stop * SR)) - XF // 2; out[j0:j0 + len(tail)] += tail[:n - j0]
peak = np.abs(out).max(); out *= min(1, .95 / max(peak, 1e-9))
f = int(.5 * SR); out[-f:] *= np.linspace(1, 0, f)[:, None]
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype(np.int16).tobytes())
print(f'wrote {OUT}: speeds {S1:.4f} / {S2:.4f}; slam at {DROP}, B from {b_start:.3f}, 1760 hit at {b_start + 5 * BAR0 * S2:.3f}, stop at {stop:.2f}')
