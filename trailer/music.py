#!/usr/bin/env python3
"""The trailer's music: composed and synthesised here, nothing sampled. 100 BPM (one beat = 0.6 s, a bar = 2.4 s), so
every cut in the edit lands on a beat. Sections follow the edit (edl.json): a pulse for today's city, a folk texture for
1760 (plucked cittern, a droning squeezebox, a fiddle line), both together for the two-era shots, bells for the
Christmas beat, then one resolving chord. D minor / F major throughout.
  python3 music.py out.wav total_seconds
"""
import sys, numpy as np

SR = 48000
BPM = 100
BEAT = 60 / BPM
OUT, TOTAL = sys.argv[1], float(sys.argv[2])
N = int(TOTAL * SR) + SR
rng = np.random.default_rng(7)

def hz(midi): return 440 * 2 ** ((midi - 69) / 12)
def env(n, a, d, s, r, hold):
    """ADSR over n samples: attack a, decay d (to sustain s), hold, release r (seconds)."""
    t = np.arange(n) / SR
    e = np.ones(n) * s
    A = t < a; e[A] = t[A] / max(a, 1e-4)
    D = (t >= a) & (t < a + d); e[D] = 1 - (1 - s) * (t[D] - a) / max(d, 1e-4)
    R = t >= hold; e[R] = s * np.exp(-(t[R] - hold) / max(r / 4, 1e-3))
    return e
from scipy.signal import lfilter
def lowpass(x, cutoff):
    """one-pole lowpass (cutoff Hz; an array sweep is averaged)."""
    c = float(np.mean(cutoff)); a = 1 - np.exp(-2 * np.pi * c / SR)
    return lfilter([a], [1, -(1 - a)], x)
def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    ph = (t * f) % 1.0; s = 2 * ph - 1
    if detune:
        s = (s + (2 * ((t * f * (1 + detune)) % 1.0) - 1) + (2 * ((t * f * (1 - detune)) % 1.0) - 1)) / 3
    return s
def tri(f, n): t = np.arange(n) / SR; return 2 * np.abs(2 * ((t * f) % 1.0) - 1) - 1
def sine(f, n, vib=0.0, vibf=5.5):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t + vib * np.sin(2 * np.pi * vibf * t))

buses = {k: np.zeros(N) for k in ['pad', 'bass', 'drums', 'pluck', 'lead', 'bells', 'drone']}

def place(bus, start, sig, gain=1.0):
    i = int(start * SR); j = min(N, i + len(sig))
    if i < 0 or i >= N: return
    buses[bus][i:j] += sig[:j - i] * gain

# ---- instruments -------------------------------------------------------------------------------------------------
def pad(start, midis, dur, gain=.16):
    n = int((dur + 1.5) * SR)
    for m in midis:
        s = saw(hz(m), n, detune=.006) * env(n, .6, .4, .8, 1.5, dur)
        s = lowpass(s, 1700)
        place('pad', start, s, gain / len(midis))
def bass(start, midi, dur, gain=.3):
    n = int((dur + .3) * SR); f = hz(midi)
    s = (saw(f, n) * .7 + sine(f / 2, n) * .25) * env(n, .005, .12, .55, .25, dur)
    s = np.tanh(lowpass(s, 900) * 2.2) / 2.2  # a little grit so the line reads on a phone speaker
    place('bass', start, s, gain)
def kick(start, gain=.4):
    n = int(.35 * SR); t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    place('drums', start, s, gain)
def hat(start, gain=.2, open_=False):
    n = int((.25 if open_ else .06) * SR)
    s = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * (9 if open_ else 70))
    s = s - lowpass(s, 6000)  # highpass
    place('drums', start, s, gain)
def snare(start, gain=.35):
    n = int(.22 * SR); t = np.arange(n) / SR
    s = rng.standard_normal(n) * np.exp(-t * 18) * .8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * .6
    place('drums', start, s, gain)
def tamb(start, gain=.12):
    n = int(.12 * SR); s = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 40)
    s = s - lowpass(s, 4500); place('drums', start, s, gain)
def pluck(start, midi, dur=.5, gain=.42, bright=1.0):
    """Karplus-Strong string: a cittern / mandolin kind of pluck."""
    f = hz(midi); n = int((dur + .8) * SR); L = int(SR / f)
    buf = rng.uniform(-1, 1, L); out = np.empty(n); damp = .996 if bright > .5 else .992
    for i in range(n):
        out[i] = buf[i % L]
        buf[i % L] = damp * .5 * (buf[i % L] + buf[(i + 1) % L])
    out *= env(n, .002, .05, 1, .5, dur)
    place('pluck', start, out, gain)
def fiddle(start, midi, dur, gain=.3):
    n = int((dur + .5) * SR); f = hz(midi)
    bow = saw(f, n, detune=.004) * .55 + tri(f, n) * .45
    vib = np.sin(2 * np.pi * 5.6 * np.arange(n) / SR) * np.clip((np.arange(n) / SR - .15) * 2, 0, 1)
    t = np.arange(n) / SR
    s = (saw(f * (1 + .004 * vib), n) * .5 + tri(f * (1 + .004 * vib), n) * .5) * env(n, .09, .1, .85, .35, dur)
    place('lead', start, lowpass(s, 2600), gain)
def squeeze(start, midis, dur, gain=.14):
    """accordion-like reeds: detuned saws, slow filter."""
    n = int((dur + .6) * SR)
    for m in midis:
        s = saw(hz(m), n, detune=.0035) * env(n, .25, .2, .9, .5, dur)
        place('drone', start, lowpass(s, 1400), gain / len(midis))
def bell(start, midi, gain=.3):
    n = int(2.5 * SR); t = np.arange(n) / SR; f = hz(midi)
    s = (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 3) + .3 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 6)) * np.exp(-t * 2.2)
    place('bells', start, s, gain)
def riser(start, dur, gain=.16):
    """filtered noise opening up over dur seconds, into a cut."""
    n = int(dur * SR); t = np.arange(n) / SR
    s = rng.standard_normal(n) * (t / dur) ** 2
    s = lowpass(s, 2500) - lowpass(s, 300)
    place('drums', start, s, gain)
def hit(start, gain=.5):
    """a cut-point accent: kick plus a short bright burst."""
    kick(start, gain)
    n = int(.5 * SR); t = np.arange(n) / SR
    s = rng.standard_normal(n) * np.exp(-t * 7)
    s = s - lowpass(s, 1500)
    place('drums', start, s, gain * .28)
def synthlead(start, midi, dur, gain=.34):
    n = int((dur + .4) * SR); f = hz(midi)
    s = saw(f, n, detune=.008) * env(n, .02, .15, .7, .3, dur)
    place('lead', start, lowpass(s, 3200), gain)

# ---- the piece ----------------------------------------------------------------------------------------------------
D, F, A, C, Bb, G, E = 62, 65, 69, 72, 70, 67, 64
# chord per bar (root midi, chord tones), D minor: Dm - Bb - F - C, with a Gm turnaround
PROG = [[D, F, A], [Bb - 12, D, F], [F - 12, A, C], [C - 12, E, G]]

# section bounds from the edit; each section has its own bar grid starting on its first frame, so every drop lands on the cut
import json, os
_E = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'edl.json')))
SEC = {}; _t = 0.0
for _s in _E['segments']:
    _k = {'1760': 'old'}.get(_s['act'], _s['act']); SEC.setdefault(_k, [_t, 0]); _t += _s['d']; SEC[_k][1] = round(_t, 2)
SEC = {k: (round(v[0], 2), v[1]) for k, v in SEC.items()}
CHRISTMAS = SEC['seasons'][0] + [x['d'] for x in _E['segments'] if x['act'] == 'seasons'][0]  # the second seasonal shot

def bars(name):
    """(bar index, bar start, section end) for each bar of a section; the last bar may be cut short."""
    a, z = SEC[name]; nb = int(np.ceil((z - a) / (4 * BEAT) - 1e-6))
    for b in range(nb): yield b, a + b * 4 * BEAT, z

melody = [A, C, D + 12, C, A, G, F, G, A, F, D, F, G, A, C, A]   # the hook, in D minor (dorian colour on the B natural below)
folk = [D, F, G, A, C, A, G, F, E, F, G, A, G, F, E, D]          # the 1760 line, a bar each pair of notes

# hook: pads and a plucked line under the logo, a soft pulse from the second bar, a riser into the drop
for b, t0, z in bars('hook'):
    chord = PROG[b % 4]; pad(t0, [m - 12 for m in chord] + [chord[0]], min(4 * BEAT, z - t0), gain=.14)
    if b == 0: kick(0.0, .9); bell(0.7, D + 12, .25)  # the title lands at 0.7 s
    for k in range(4):
        t = t0 + k * BEAT
        if t >= z - 1e-6: break
        pluck(t, melody[(b * 4 + k) % 16] - 12, .5, .3, .3)
        if t0 >= 4.8 - 1e-6: kick(t, .14); hat(t + BEAT / 2, .1)
riser(SEC['today'][0] - 2.4, 2.4, .14)

# today: the pulse (kick, snare, bass, hats) with the synth lead on the hook melody
for b, t0, z in bars('today'):
    chord = PROG[b % 4]; pad(t0, [m - 12 for m in chord] + [chord[0]], min(4 * BEAT, z - t0), gain=.2)
    root = chord[0] - 12
    for k in range(8):
        t = t0 + k * BEAT / 2
        if t >= z - 1e-6: break
        bass(t, root if k % 4 != 3 else root + 12, BEAT / 2 * .9, .26); hat(t, .18 if k % 2 == 0 else .12)
    for k, (fn, g) in enumerate([(kick, .36), (snare, .35), (kick, .36), (snare, .35)]):
        t = t0 + k * BEAT
        if t < z - 1e-6: fn(t, g)
    if t0 + 2.5 * BEAT < z - 1e-6: kick(t0 + 2.5 * BEAT, .4)
    for k in range(4):
        t = t0 + k * BEAT
        if t < z - 1e-6: synthlead(t, melody[(b * 4 + k) % 16], BEAT * .9, .36 if (b % 2) else .3)
    if b % 4 == 3 and t0 + 3.5 * BEAT < z - 1e-6: hat(t0 + 3.5 * BEAT, .12, True)
riser(SEC['card'][0] - 2.4, 2.4, .16)

# card: everything stops; a squeezebox drone, a kick on the cut, bells on the two lines
c0, cz = SEC['card']
squeeze(c0, [D - 12, A - 12, D], cz - c0, gain=.12); kick(c0, 1.0); bell(c0 + .05, D, .18); bell(c0 + 1.8, A, .14)  # "Copenhagen, 1760." at 1.9 s

# 1760: cittern plucks, tambourine, the fiddle line over the squeezebox
for b, t0, z in bars('old'):
    chord = PROG[b % 4]; squeeze(t0, [chord[0] - 12, chord[1], chord[2]], min(4 * BEAT, z - t0), gain=.17)
    for k in range(8):
        t = t0 + k * BEAT / 2
        if t >= z - 1e-6: break
        pluck(t, chord[k % 3] - (12 if k % 2 == 0 else 0), .45, .46, .9)
    for t, fn, g in [(t0 + BEAT, tamb, .12), (t0 + 3 * BEAT, tamb, .12), (t0, kick, .5), (t0 + 2.5 * BEAT, kick, .3)]:
        if t < z - 1e-6: fn(t, g)
    for k in range(2):
        t = t0 + k * 2 * BEAT
        if t < z - 1e-6: fiddle(t, folk[(b * 2 + k) % 16], min(BEAT * 1.9, z - t + .2), .36)
riser(SEC['both'][0] - 1.8, 1.8, .14)

# both eras: the pulse and the folk texture together
for b, t0, z in bars('both'):
    chord = PROG[b % 4]
    if b == 0: hit(t0, .55)
    pad(t0, [m - 12 for m in chord] + [chord[0]], min(4 * BEAT, z - t0), gain=.16); squeeze(t0, [chord[0] - 12, chord[1]], min(4 * BEAT, z - t0), gain=.09)
    root = chord[0] - 12
    for k in range(8):
        t = t0 + k * BEAT / 2
        if t >= z - 1e-6: break
        bass(t, root, BEAT / 2 * .9, .26); hat(t, .16); pluck(t, chord[k % 3], .45, .22, .9)
    for k, (fn, g) in enumerate([(kick, .4), (snare, .35), (kick, .4), (snare, .35)]):
        t = t0 + k * BEAT
        if t < z - 1e-6: fn(t, g)
    for k in range(2):
        t = t0 + k * 2 * BEAT
        if t < z - 1e-6: fiddle(t, folk[(b * 2 + k) % 16] + 12, BEAT * 1.9, .3)

# seasons: the pulse again; the lead turns to bells on the Christmas shot
for b, t0, z in bars('seasons'):
    chord = PROG[b % 4]
    if b == 0: hit(t0, .5)
    pad(t0, [m - 12 for m in chord] + [chord[0]], min(4 * BEAT, z - t0), gain=.16)
    root = chord[0] - 12
    for k in range(8):
        t = t0 + k * BEAT / 2
        if t >= z - 1e-6: break
        bass(t, root, BEAT / 2 * .9, .24); hat(t, .15)
    for k, (fn, g) in enumerate([(kick, .4), (snare, .35), (kick, .4), (snare, .35)]):
        t = t0 + k * BEAT
        if t < z - 1e-6: fn(t, g)
    for k in range(4):
        t = t0 + k * BEAT; m = melody[(b * 4 + k) % 16]
        if t >= z - 1e-6: break
        if t >= CHRISTMAS - 1e-6: bell(t, m + 12, .2)
        else: synthlead(t, m, BEAT * .9, .32)

# the final chord on the end card: D minor with a raised third (Picardy), ringing
e0 = SEC['end'][0]
riser(e0 - 1.8, 1.8, .14)
kick(e0, .8); pad(e0, [D - 12, A - 12, D, F + 1, A], 5.5, gain=.2); bell(e0, D + 12, .3); bell(e0 + .6, A + 12, .2); bell(e0 + 1.2, F + 13, .22)
pluck(e0 + .0, D - 12, 2.5, .4, .9)

# ---- mix ----------------------------------------------------------------------------------------------------------
def reverb(x, mix=.22, spread=1.0):
    out = np.zeros_like(x)
    for d, g in [(.0297, .74), (.0371, .71), (.0411, .68), (.0437, .66)]:
        n = int(d * spread * SR); b = np.zeros(n + 1); b[n] = 1; a = np.zeros(n + 1); a[0] = 1; a[n] = -g
        out += lfilter(b, a, x)
    out /= 4
    for d in [.005, .0017]:
        n = int(d * SR); b = np.zeros(n + 1); b[0] = -.5; b[n] = 1; a = np.zeros(n + 1); a[0] = 1; a[n] = -.5
        out = lfilter(b, a, out)
    return x * (1 - mix) + out * mix

PAN = {'pad': 0.0, 'bass': 0.0, 'drums': 0.0, 'pluck': -.35, 'lead': .3, 'bells': .25, 'drone': -.3}  # -1 left .. 1 right
def panned(k):
    th = (PAN[k] + 1) / 2 * np.pi / 2; return buses[k] * np.cos(th), buses[k] * np.sin(th)
def channel(side):
    dry = sum(panned(k)[side] for k in ['bass', 'drums']) + panned('pluck')[side] * .2
    wet = sum(panned(k)[side] for k in ['pad', 'lead', 'bells', 'drone']) + panned('pluck')[side] * .8
    return dry + reverb(wet, .35, 1.0 if side == 0 else 1.06)
L = channel(0); R = channel(1)
# soft limiter (the same gain both sides, so the image holds), then the fade at the very end
peak = np.maximum(np.abs(L), np.abs(R)); g = np.tanh(peak * 1.6) * .8 / np.maximum(peak, 1e-9)
L = (L * g)[:int(TOTAL * SR)]; R = (R * g)[:int(TOTAL * SR)]
tail = int(1.5 * SR); L[-tail:] *= np.linspace(1, 0, tail); R[-tail:] *= np.linspace(1, 0, tail)
st = np.stack([L, R], 1)
st = (st / max(1e-6, np.abs(st).max()) * .89 * 32767).astype(np.int16)
mix = L
import wave
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print('wrote', OUT, round(len(mix) / SR, 2), 's')
