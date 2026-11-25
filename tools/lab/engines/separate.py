"""Source separation with Demucs (htdemucs, MIT): splits a song into vocals, bass, drums and other.
Each stem is then turned into notes on its own, which is far easier than finding notes in the full mix.
We call the model directly (not demucs.audio / demucs.separate), so no MP3 encoder is needed.

usage: python -I separate.py <in.wav (any rate, mono or stereo 16-bit)> <out_dir>   -> out_dir/stem_<name>.wav (22,050 Hz mono 16-bit)
"""
import sys, os
import numpy as np
from scipy.io import wavfile

def main():
    inp, out = sys.argv[1], sys.argv[2]
    import torch
    import demucs.pretrained as pre, demucs.apply as ap
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    sr, x = wavfile.read(inp)
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    x = np.stack([x, x]) if x.ndim == 1 else x.T[:2]
    if sr != 44100:
        from scipy.signal import resample_poly
        from math import gcd
        g = gcd(44100, sr); x = resample_poly(x, 44100 // g, sr // g, axis=1).astype(np.float32)
    print('PROGRESS 0.05', flush=True)
    model = pre.get_model('htdemucs'); model.eval()
    wav = torch.from_numpy(x)[None]
    ref = wav.mean(0); wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        src = ap.apply_model(model, wav, device='cpu', shifts=0, split=True, overlap=0.25, progress=False)[0]
    src = src * (ref.std() + 1e-8) + ref.mean()
    print('PROGRESS 0.9', flush=True)
    from scipy.signal import resample_poly
    os.makedirs(out, exist_ok=True)
    for name, s in zip(model.sources, src):
        m = resample_poly(s.mean(0).numpy(), 1, 2).astype(np.float32)          # 44,100 -> 22,050 Hz mono
        wavfile.write(os.path.join(out, 'stem_%s.wav' % name), 22050, (np.clip(m, -1, 1) * 32767).astype(np.int16))
    print('DONE', ' '.join(model.sources), flush=True)

if __name__ == '__main__':
    try:
        main()
    except ImportError as e:
        print('Missing Python package (%s). Run: node tools/lab/setup.js --separate' % e.name, file=sys.stderr); sys.exit(2)
