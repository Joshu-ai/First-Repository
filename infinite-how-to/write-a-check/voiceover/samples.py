import numpy as np, soundfile as sf, librosa
from kokoro_onnx import Kokoro
K = Kokoro('models/kokoro.onnx', 'models/voices.bin')
print(sorted(K.get_voices()))
text = "Here's how to write a check, like you're five. A check is a note to your bank: please give this person my money."
for v, sp in [('af_heart',1.0),('af_bella',1.0),('am_michael',0.95),('am_puck',1.0),('am_fenrir',0.95),('bf_emma',1.0)]:
    a, sr = K.create(text, voice=v, speed=sp, lang='en-us')
    a = librosa.resample(a.astype(np.float32), orig_sr=sr, target_sr=48000)
    sf.write(f'samples/{v}.wav', a/np.abs(a).max()*0.89, 48000)
    print(v, round(len(a)/48000,2), 's')
