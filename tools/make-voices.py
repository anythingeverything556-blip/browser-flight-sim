#!/usr/bin/env python3
"""Generate the cockpit voice-warning clips in public/audio/voice/<style>/<key>.mp3.

Voices (all redistributable):
  betty - Kokoro-82M 'af_bella' (Apache-2.0), US fighter style female
  gpws  - Kokoro-82M 'am_michael' (Apache-2.0), US airliner GPWS style male
  rita  - Piper 'ru_RU-denis-medium' (MIT model, CC0 dataset), Russian fighter style phrases

Setup (CPU is fine):
  uv venv /tmp/tts-venv && uv pip install --python /tmp/tts-venv/bin/python \
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
    torch 'kokoro>=0.9' piper-tts soundfile numpy scipy
  apt-get install espeak-ng ffmpeg
  /tmp/tts-venv/bin/python tools/make-voices.py
"""
import subprocess
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'audio' / 'voice'
SR = 24000

# Keys match the warning flags in src/main.js; keep the text short so a repeat fits the warning cadence.
PHRASES = {
    'betty': {
        'pullUp': 'Pull up. Pull up.',
        'stall': 'Stall. Stall.',
        'overG': 'Over G. Over G.',
        'overspeed': 'Overspeed. Overspeed.',
        'gearUnsafe': 'Check gear. Check gear.',
        'lowFuel': 'Bingo fuel. Bingo fuel.',
    },
    'gpws': {
        'pullUp': 'Terrain. Pull up.',
        'stall': 'Stall. Stall.',
        'overG': 'Over G.',
        'overspeed': 'Overspeed.',
        'gearUnsafe': 'Too low. Gear.',
        'lowFuel': 'Low fuel.',
    },
    'rita': {
        'pullUp': 'Опасная высота! Выводи!',
        'stall': 'Критический угол атаки!',
        'overG': 'Предельная перегрузка!',
        'overspeed': 'Предельная скорость!',
        'gearUnsafe': 'Выпусти шасси!',
        'lowFuel': 'Мало топлива! Мало топлива!',
    },
}

PIPER_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/denis/medium/'
CACHE = Path(tempfile.gettempdir()) / 'sr71-voice-cache'


def kokoro_lines(voice, lines, speed):
    from kokoro import KPipeline
    pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
    out = {}
    for key, text in lines.items():
        parts = [np.asarray(audio, dtype=np.float32) for _, _, audio in pipe(text, voice=voice, speed=speed)]
        out[key] = np.concatenate(parts)
    return out, 24000


def piper_lines(lines, length_scale):
    from piper import PiperVoice, SynthesisConfig
    CACHE.mkdir(parents=True, exist_ok=True)
    model = CACHE / 'ru_RU-denis-medium.onnx'
    for name in (model.name, model.name + '.json'):
        if not (CACHE / name).exists():
            urllib.request.urlretrieve(PIPER_BASE + name, CACHE / name)
    voice = PiperVoice.load(str(model))
    cfg = SynthesisConfig(length_scale=length_scale)
    out = {}
    for key, text in lines.items():
        out[key] = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float32)
    return out, voice.config.sample_rate


def trim(x, thresh=0.012, pad=0.03):
    idx = np.flatnonzero(np.abs(x) > thresh * np.max(np.abs(x)) * 4)
    if not len(idx):
        return x
    p = int(pad * SR)
    return x[max(0, idx[0] - p): idx[-1] + p]


def cockpit(x, crush_bits=0, hold=1):
    """Intercom-style band limit, presence lift and soft clip; optional digitizer grit for the retro voices."""
    x = sosfilt(butter(2, 300, 'highpass', fs=SR, output='sos'), x)
    x = sosfilt(butter(4, 4300, 'lowpass', fs=SR, output='sos'), x)
    presence = sosfilt(butter(2, [1700, 3000], 'bandpass', fs=SR, output='sos'), x)
    x = x + 0.6 * presence
    x = x / (np.sqrt(np.mean(x ** 2)) + 1e-9) * 0.16   # loudness-match the styles before the clipper
    x = np.tanh(2.2 * x) / np.tanh(2.2)
    if hold > 1:   # sample-and-hold decimation, like an old voice ROM
        x = np.repeat(x[::hold], hold)[: len(x)]
    if crush_bits:
        q = 2 ** (crush_bits - 1)
        x = np.round(x * q) / q
    x = sosfilt(butter(2, 5000, 'lowpass', fs=SR, output='sos'), x)
    fade = int(0.006 * SR)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return (x / (np.max(np.abs(x)) + 1e-9) * 0.89).astype(np.float32)   # about -1 dBFS


def write_mp3(path, x):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        with wave.open(tmp.name, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', str(path)], check=True)


def main():
    styles = sys.argv[1:] or list(PHRASES)
    settings = {'betty': dict(crush_bits=8, hold=2), 'gpws': dict(), 'rita': dict(crush_bits=10)}
    for style in styles:
        lines = PHRASES[style]
        if style == 'betty':
            raw, sr = kokoro_lines('af_bella', lines, speed=1.05)
        elif style == 'gpws':
            raw, sr = kokoro_lines('am_michael', lines, speed=0.9)
        else:
            raw, sr = piper_lines(lines, length_scale=1.0)
        for key, audio in raw.items():
            if sr != SR:
                audio = resample_poly(audio, SR, sr).astype(np.float32)
            clip = cockpit(trim(audio), **settings[style])
            write_mp3(OUT / style / f'{key}.mp3', clip)
            print(f'{style}/{key}.mp3  {len(clip) / SR:.2f}s  "{lines[key]}"')


if __name__ == '__main__':
    main()
