"""Beat-locked score, synthesized entirely in code.

  python3 score.py mix <key> [--vo build/<key>/vo.wav]
      reads build/<key>/render.json (bpm, offset, shots, cues) and writes build/<key>/mix.wav:
      pad on the bar lines, kick/clap/hats on the grid, a hit on every cut, a whoosh that lands
      exactly on every cut, a riser into the last cut. Ducks under a voiceover if one is given.
  python3 score.py fit <t1,t2,...> [--lo 84 --hi 132 --div 1]
      for voiceover-led videos: finds the tempo and offset that put the wanted cut times
      closest to beats, and prints the snapped times to use as SHOTS.
"""
import json, sys
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
from pedalboard import Pedalboard, Reverb, LowpassFilter, HighpassFilter, Chorus
import pyloudnorm as pyln

SR = 48000
R = np.random.default_rng(11)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
arg = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d


def fit(cues, lo=84, hi=132, div=1):
    best = None
    for bpm in np.arange(lo, hi + .01, .5):
        spb = 60 / bpm / div
        for off in np.arange(0, spb, .005):
            err = [abs(c - (off + round((c - off) / spb) * spb)) for c in cues]
            score = max(err) + .25 * np.mean(err)
            if best is None or score < best[0]:
                best = (score, bpm, off, [round(off + round((c - off) / spb) * spb, 3) for c in cues], max(err))
    return {'bpm': float(best[1]), 'offset': round(float(best[2]), 3), 'snapped': best[3], 'max_shift_s': round(best[4], 3)}


def bandnoise(n, lo, hi):
    return sosfilt(butter(2, [lo, hi], btype='band', fs=SR, output='sos'), R.standard_normal(n))


def tone(f, n, harm=6):
    t = np.arange(n) / SR; y = np.zeros(n)
    for c in (-7, 0, 7):
        ph = 2 * np.pi * f * 2 ** (c / 1200) * t + R.random() * 6
        for h in range(1, harm + 1): y += np.sin(h * ph) / h ** 1.6
    return y / 3


def kick(n):
    t = np.arange(n) / SR; f = 50 + 110 * np.exp(-t * 38)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) + .25 * bandnoise(n, 1500, 6000) * np.exp(-t * 300)


def clap(n):
    t = np.arange(n) / SR; e = sum(np.exp(-np.clip(t - d, 0, None) * 60) * (t >= d) for d in (0, .011, .023))
    return bandnoise(n, 900, 5200) * e * .6


def hat(n, open_=False):
    t = np.arange(n) / SR; return bandnoise(n, 6000, 15000) * np.exp(-t * (18 if open_ else 90))


def hit(n):
    t = np.arange(n) / SR; f = 46 * np.exp(-t * 1.4) + 30
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) + .4 * bandnoise(n, 80, 1400) * np.exp(-t * 16)


def whoosh(n):
    t = np.linspace(0, 1, n); y = np.zeros(n); seg = 1024
    for s in range(0, n, seg):
        lo = 300 + 2200 * (s / n) ** 2; part = bandnoise(min(seg, n - s) + 512, lo, min(lo * 2.4, 20000))[512:]
        y[s:s + len(part)] = part
    return y * t ** 2.2 * (1 - np.clip((t - .97) / .03, 0, 1)) * 1.4   # swells INTO the cut, ends on it


def riser(n):
    t = np.linspace(0, 1, n); f = 200 + 1800 * t ** 2
    return (bandnoise(n, 500, 7000) * .6 + .4 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * t ** 2.6


def chime(n, f=1318.5):
    t = np.arange(n) / SR
    return sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 2.2), (2.76, .4, 3.5), (5.4, .15, 6)])


# ---------- event sound effects (window.SFX / cues.sfx = [{t, kind, gain, dur?}]) ----------
def _jit(t, k=1):  # small pitch/time jitter seeded by t, so repeats never sound copied
    r = np.random.default_rng(int(round(t * 1000)) * 7 + k); return r

def sfx_pop(n, r):
    t = np.arange(n) / SR; f0 = 760 * (1 + .08 * r.standard_normal())
    f = f0 * (1 + .9 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38) + .15 * bandnoise(n, 2000, 7000) * np.exp(-t * 400)

def sfx_scratch(n, r):
    t = np.arange(n) / SR; rate = 9 + 3 * r.random()
    am = .55 + .45 * np.abs(np.sin(np.pi * rate * t + r.random() * 3))
    env = np.minimum(1, t / .03) * np.minimum(1, (n / SR - t) / .06)
    return bandnoise(n, 1800, 7500) * am * env * .5

def sfx_slide(n, r):
    t = np.linspace(0, 1, n); y = np.zeros(n); seg = 1024
    for s0 in range(0, n, seg):
        lo = 500 + 900 * (s0 / n); part = bandnoise(min(seg, n - s0) + 512, lo, lo * 2.2)[512:]; y[s0:s0 + len(part)] = part
    return y * np.sin(np.pi * t) ** 1.5 * .7

def sfx_thud(n, r):
    t = np.arange(n) / SR; f = 62 * (1 + .05 * r.standard_normal()) * (1 + .6 * np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) + .2 * bandnoise(n, 60, 500) * np.exp(-t * 25)

def sfx_knock(n, r):
    t = np.arange(n) / SR; y = np.zeros(n)
    for d in (0, .11 + .01 * r.random()):
        tt = np.clip(t - d, 0, None); on = t >= d
        y += on * (np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 45) + .5 * bandnoise(n, 500, 1600) * np.exp(-tt * 70))
    return y * .8

def sfx_boing(n, r):
    t = np.arange(n) / SR; f = 260 * (1 + .06 * r.standard_normal()) * (1 + .35 * np.sin(2 * np.pi * 11 * t) * np.exp(-t * 4)) * (1 + .8 * t)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5) * .8

def sfx_sparkle(n, r):
    y = np.zeros(n)
    for i, m in enumerate((84, 88, 91, 96)):
        d = int((.06 * i + .01 * r.random()) * SR)
        if d < n: y[d:] += chime(n - d, hz(m)) * .5
    return y

def sfx_tick(n, r):
    t = np.arange(n) / SR; return bandnoise(n, 3000, 9000) * np.exp(-t * 500)

SFX = {'pop': (sfx_pop, .25), 'scratch': (sfx_scratch, .8), 'slide': (sfx_slide, .3), 'thud': (sfx_thud, .6),
       'knock': (sfx_knock, .35), 'boing': (sfx_boing, .55), 'sparkle': (sfx_sparkle, 1.6), 'tick': (sfx_tick, .05)}


def mix(key):
    d = json.load(open(f'build/{key}/render.json'))
    dur, B, cues = d['dur'], d['beat'], d.get('cues', {})
    bpm, off = B['bpm'], B['offset']; spb = 60 / bpm; n = int(round(dur * SR))
    beats = [off + i * spb for i in range(int((dur - off) / spb) + 1)]
    music, drums, fx = np.zeros(n), np.zeros(n), np.zeros(n)

    def put(buf, y, t, g):
        s = int(round(t * SR))
        if s < 0: y, s = y[-s:], 0
        if s >= n: return  # starts after the end (e.g. the bar past the last downbeat)
        e = min(n, s + len(y)); buf[s:e] += y[: e - s] * g

    # pad: one chord per bar, changes exactly on the bar line
    prog = cues.get('chords') or [[38, 50, 57, 64, 69], [34, 46, 53, 62, 65], [43, 55, 62, 65, 70], [45, 57, 61, 64, 67]]
    bar = 4 * spb
    for i in range(int(np.ceil(dur / bar)) + 1):
        a = off + i * bar - .03; m = int((bar + .6) * SR)
        part = sum(tone(hz(nt), m) * (1.2 if j == 0 else .8 ** j) for j, nt in enumerate(prog[i % len(prog)]))
        tt = np.arange(m) / SR; part += .8 * np.sin(2 * np.pi * hz(prog[i % len(prog)][0] - 12) * tt)
        env = np.minimum(1, tt / .04) * np.minimum(1, (m / SR - tt) / .6)
        put(music, part * env, a, 1)
    music = Pedalboard([HighpassFilter(40), LowpassFilter(3000), Chorus(rate_hz=.3, depth=.2, mix=.3),
                        Reverb(room_size=.8, damping=.5, wet_level=.35, dry_level=.7)])(music.astype(np.float32)[None], SR)[0][:n]
    # drums on the grid (skip the first bar's drums if cues say 'intro_bars')
    start = cues.get('drums_from', 0)
    for i, t in enumerate(beats):
        if t < start: continue
        if i % 4 in (0, 2): put(drums, kick(int(.5 * SR)), t, 1)
        if i % 4 in (1, 3): put(drums, clap(int(.3 * SR)), t, .5)
        put(drums, hat(int(.12 * SR)), t + spb / 2, .16)
        put(drums, hat(int(.06 * SR)), t, .08)
    # sidechain: pad dips on every kick
    side = np.ones(n)
    for i, t in enumerate(beats):
        if i % 4 in (0, 2):
            s = int(t * SR); L = int(spb * SR)
            if s < n: side[s:s + L] = np.minimum(side[s:s + L], 1 - .45 * np.exp(-np.arange(min(L, n - s)) / SR * 9))
    music *= side
    # accents locked to the shots
    shots = [t for t in d['shots'] if 0 < t < dur]
    cg = cues.get('cut_gain', 1.0)
    for t in shots:
        put(fx, hit(int(1.4 * SR)), t, .55 * cg)
        put(fx, whoosh(int(.5 * SR)), t - .5, .18 * cg)
    if shots and cues.get('riser', True): put(fx, riser(int(bar * SR)), shots[-1] - bar, .12 * cg)
    for t in cues.get('chime', []): put(fx, chime(int(2 * SR)), t, .10)
    for t in cues.get('hit', []): put(fx, hit(int(1.4 * SR)), t, .5)
    fx = Pedalboard([Reverb(room_size=.7, wet_level=.25, dry_level=.85)])(fx.astype(np.float32)[None], SR)[0][:n]

    meter = pyln.Meter(SR)
    music = pyln.normalize.loudness(music, meter.integrated_loudness(music), -24)
    drums = pyln.normalize.loudness(drums, meter.integrated_loudness(drums), -24) * cues.get('drums_gain', 1.0)
    # event SFX layer, kept as its own bus so it can duck under the voice and stay below it
    ev = np.zeros(n)
    for e_ in (d.get('sfx') or cues.get('sfx', [])):
        fn, dflt = SFX[e_['kind']]; r_ = _jit(e_['t'], len(e_['kind']))
        put(ev, fn(int(e_.get('dur', dflt) * SR), r_), e_['t'] + .006 * r_.standard_normal(), e_.get('gain', .5))
    bed = music + drums + fx
    vo_path = arg('--vo')
    if vo_path:
        vo, sr = sf.read(vo_path); vo = vo if vo.ndim == 1 else vo.mean(1); assert sr == SR
        vo = np.pad(vo, (0, max(0, n - len(vo))))[:n]
        vo = pyln.normalize.loudness(vo, meter.integrated_loudness(vo), -16)
        e = np.convolve(np.abs(vo), np.ones(int(.2 * SR)) / int(.2 * SR), mode='same')
        duck = 1 - .6 * np.clip(e / (np.percentile(e, 95) + 1e-9), 0, 1)
        bed = bed * duck * .55 + ev * (1 - .35 * (1 - duck)) * cues.get('sfx_gain', .5) + vo
    else:
        bed = bed + ev * cues.get('sfx_gain', .5)
    fade = np.minimum(1, (dur - np.arange(n) / SR) / .25)
    y = bed * np.clip(fade, 0, 1)
    for _ in range(2):  # loudness to -14 LUFS (stereo), true-peak-ish ceiling at -1 dB
        y = y * 10 ** ((-17 - meter.integrated_loudness(y)) / 20)
        pk = np.max(np.abs(y)); ceil = 10 ** (-1.2 / 20)
        if pk > ceil:
            g = np.minimum(1, ceil / np.maximum(np.abs(y), 1e-9)); k = int(.003 * SR)
            g = -np.convolve(-g, np.ones(k) / k, mode='same'); y = np.clip(y * np.minimum(g, 1), -ceil, ceil)
    st = np.stack([y, y], 1).astype(np.float32)
    sf.write(f'build/{key}/mix.wav', st, SR, subtype='PCM_16')
    print(json.dumps({'key': key, 'bpm': bpm, 'dur': round(n / SR, 3), 'LUFS': round(float(meter.integrated_loudness(st)), 1),
                      'peak_dB': round(float(20 * np.log10(np.max(np.abs(st)))), 2), 'cut_accents': len(shots)}))


if __name__ == '__main__':
    if sys.argv[1] == 'fit':
        print(json.dumps(fit([float(x) for x in sys.argv[2].split(',')], float(arg('--lo', 84)), float(arg('--hi', 132)), int(arg('--div', 1)))))
    else:
        mix(sys.argv[2])
