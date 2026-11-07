#!/usr/bin/env python3
"""Generate the radio-altitude call-outs in public/audio/voice/callouts/<key>.mp3 (Airbus style: 100 ... 10 ft, then "Retard").

Same voice and cockpit filter as the GPWS warnings (Kokoro-82M 'am_michael', Apache-2.0); setup as in tools/make-voices.py.
  /tmp/tts-venv/bin/python tools/make-callouts.py
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('mv', Path(__file__).with_name('make-voices.py'))
mv = importlib.util.module_from_spec(spec); spec.loader.exec_module(mv)

LINES = {'h100': 'One hundred.', 'h90': 'Ninety.', 'h80': 'Eighty.', 'h70': 'Seventy.', 'h60': 'Sixty.', 'h50': 'Fifty.', 'h40': 'Forty.',
         'h30': 'Thirty.', 'h20': 'Twenty.', 'h10': 'Ten.', 'retard': 'Retard. Retard.'}

def main():
    raw, sr = mv.kokoro_lines('am_michael', LINES, speed=1.18)   # a quick cadence: at 600 ft/min the numbers come ~1 s apart
    for key, x in raw.items():
        if sr != mv.SR:
            from scipy.signal import resample_poly
            x = resample_poly(x, mv.SR, sr)
        y = mv.cockpit(mv.trim(x))
        mv.write_mp3(mv.OUT / 'callouts' / f'{key}.mp3', y)
        print(key, f'{len(y) / mv.SR:.2f} s')

if __name__ == '__main__':
    main()
