"""Engines that follow ONE melody line (monophonic): pYIN (librosa, ISC) and CREPE (torchcrepe, MIT).
They find the pitch curve, then this script cuts it into notes. They are independent of Basic Pitch,
so where they agree with it the notes are very likely right.

usage: python -I f0engine.py --method pyin|crepe <in.wav (22,050 Hz mono 16-bit)> <out.json>
"""
import argparse, json, sys, time
import numpy as np
from scipy.io import wavfile
from scipy.signal import medfilt, resample_poly


def load(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    return (x.mean(axis=1) if x.ndim > 1 else x), sr


def f0_pyin(x, sr):
    import librosa
    hop = 256
    f0, voiced, prob = librosa.pyin(x, fmin=65.0, fmax=2100.0, sr=sr, frame_length=2048, hop_length=hop)
    return f0, np.arange(len(f0)) * hop / sr, hop / sr


def f0_crepe(x, sr):
    import torch, torchcrepe
    y = resample_poly(x, 16000, sr).astype(np.float32)
    hop = 160                                                       # 10 ms
    audio = torch.from_numpy(y)[None]
    f0, per = torchcrepe.predict(audio, 16000, hop, 65.0, 2100.0, model='full', decoder=torchcrepe.decode.viterbi,
                                 return_periodicity=True, batch_size=512, device='cpu')
    per = torchcrepe.filter.median(per, 3)
    f0 = torchcrepe.threshold.At(0.21)(f0, per)                     # unvoiced frames become NaN
    f0 = f0[0].numpy()
    return f0, np.arange(len(f0)) * hop / 16000, hop / 16000


def to_notes(f0, times, step, min_dur=0.06, max_gap=0.05):
    midi = 69 + 12 * np.log2(np.where(np.isfinite(f0) & (f0 > 0), f0, np.nan) / 440.0)
    voiced = np.isfinite(midi)
    r = np.where(voiced, np.round(midi), 0).astype(int)
    r = np.where(voiced, medfilt(r.astype(float), 5).astype(int), 0)   # 5-frame median removes one-frame pitch flicker
    notes, i, n = [], 0, len(r)
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and voiced[j + 1] and r[j + 1] == r[i]:
            j += 1
        notes.append([int(r[i]), times[i], (j - i + 1) * step])
        i = j + 1
    merged = []                                                     # join same-pitch pieces split by a tiny gap
    for m, s, d in notes:
        if merged and merged[-1][0] == m and s - (merged[-1][1] + merged[-1][2]) <= max_gap:
            merged[-1][2] = s + d - merged[-1][1]
        else:
            merged.append([m, s, d])
    return [{'midi': m, 'start': round(float(s), 4), 'dur': round(float(d) * 1000, 1), 'vel': 80} for m, s, d in merged if d >= min_dur]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--method', choices=['pyin', 'crepe'], required=True)
    ap.add_argument('wav'); ap.add_argument('out')
    a = ap.parse_args()
    t0 = time.time()
    x, sr = load(a.wav)
    print('PROGRESS 0.05', flush=True)
    f0, times, step = (f0_pyin if a.method == 'pyin' else f0_crepe)(x, sr)
    print('PROGRESS 0.9', flush=True)
    notes = to_notes(f0, times, step)
    with open(a.out, 'w') as f:
        json.dump({'engine': a.method, 'notes': notes, 'took': round(time.time() - t0, 1)}, f)
    print('DONE', len(notes), flush=True)


if __name__ == '__main__':
    try:
        main()
    except ImportError as e:
        print('Missing Python package (%s). Run: node tools/lab/setup.js%s' % (e.name, ' --crepe' if 'torch' in str(e.name) else ''), file=sys.stderr)
        sys.exit(2)
