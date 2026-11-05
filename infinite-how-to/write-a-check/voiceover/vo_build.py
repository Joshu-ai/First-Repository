import json, re, sys, numpy as np, soundfile as sf, librosa
from kokoro_onnx import Kokoro
from pocketsphinx import Decoder
SR = 48000
K = Kokoro('models/kokoro.onnx', 'models/voices.bin')
def trim(y, top_db=38):
    idx = np.where(np.abs(y) > 10 ** (-top_db / 20) * np.max(np.abs(y)))[0]
    return y if not len(idx) else y[max(0, idx[0] - 360):idx[-1] + 960]
def align(y16, match):
    d = Decoder(samprate=16000, bestpath=False, loglevel='FATAL')
    words = [m for m in match if m]
    if any(d.lookup_word(m) is None for m in words): return None
    try:
        d.set_align_text(' '.join(words))
        d.start_utt(); d.process_raw((np.clip(y16, -1, 1) * 32767).astype(np.int16).tobytes(), full_utt=True); d.end_utt()
        segs = [(re.sub(r'\(\d+\)$', '', s.word), s.start_frame / 100, (s.end_frame + 1) / 100) for s in d.seg()]
    except Exception: return None
    segs = [s for s in segs if s[0] not in ('<sil>', '<s>', '</s>', '(NULL)', '[NOISE]') and not s[0].startswith('+')]
    if len(segs) != len(words): return None
    out, j = [], 0
    for m in match:
        if m: out.append(segs[j][1:]); j += 1
        else: out.append(out[-1] if out else (0.0, 0.05))
    return out
def proportional(dur, match):
    s = [max(1, len(re.findall(r'[aeiouy]+', m))) + 0.6 for m in match]; t, out = 0.0, []
    for x in s: a = t; t += dur * x / sum(s); out.append((a, t))
    return out
def build(lines, voice, speed, lead=0.12, tail=0.45, out='build'):
    chunks, t, L, W = [np.zeros(int(lead * SR), np.float32)], lead, [], []
    for li, (text, pause, say) in enumerate(lines):
        a, sr = K.create(say or text, voice=voice, speed=speed, lang='en-us'); a = trim(a.astype(np.float32))
        y16 = librosa.resample(a, orig_sr=sr, target_sr=16000); a48 = librosa.resample(a, orig_sr=sr, target_sr=SR); dur = len(a48) / SR
        disp = (say or text).split(); match = [re.sub(r"[^a-z']", '', w.lower().replace('’', "'")) for w in disp]
        tm = align(y16, match); ok = tm is not None; tm = tm or proportional(dur, match)
        print(f"{li:2d} {'ALIGN' if ok else 'PROP '} {dur:5.2f}s  {text}")
        W += [{'w': w, 'start': round(t + s, 3), 'end': round(t + min(e, dur), 3), 'line': li} for w, (s, e) in zip(disp, tm)]
        L.append({'text': text, 'start': round(t, 3), 'end': round(t + dur, 3)})
        chunks += [a48, np.zeros(int(pause * SR), np.float32)]; t += dur + pause
    chunks.append(np.zeros(int(tail * SR), np.float32)); y = np.concatenate(chunks); y = y / max(1e-6, np.abs(y).max()) * 0.89
    sf.write(f'{out}/vo.wav', y, SR, subtype='PCM_16')
    json.dump({'duration': round(len(y) / SR, 3), 'voice': voice, 'speed': speed, 'lines': L, 'words': W}, open(f'{out}/timing.json', 'w'), indent=1)
    print('total', round(len(y)/SR,2), 's')
lines = json.load(open('script_lines.json'))
build([(l['text'], l['pause'], l.get('say')) for l in lines], voice=sys.argv[1] if len(sys.argv)>1 else 'af_heart', speed=float(sys.argv[2]) if len(sys.argv)>2 else 1.0)
