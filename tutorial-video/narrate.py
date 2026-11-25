"""
English voice-over for the tutorial video, made offline with the Kokoro-82M voice (Apache-2.0) and kokoro-onnx.

    python narrate.py MODEL_DIR OUT_DIR

MODEL_DIR holds model_quantized.onnx (Kokoro-82M v1.0, q8; sha256 fbae9257…a1478) and voice files such as af_heart.bin
(float32, 510 x 1 x 256, as shipped in the kokoro-js npm package). OUT_DIR gets one WAV per scene and timing.json:
    {"sample_rate": 24000, "scenes": {"<id>": {"voice": seconds, "lead": s, "tail": s, "lines": [[start, length, subtitle], ...]}}}
render.cjs lengthens a scene when its narration needs more time; mix.py lays the WAVs on the final timeline.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))


def main(model_dir: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    spec = json.load(open(os.path.join(HERE, 'narration.json'), encoding='utf-8'))

    voices = {}
    for name in os.listdir(model_dir):
        if name.endswith('.bin'):
            voices[name[:-4]] = np.fromfile(os.path.join(model_dir, name), dtype=np.float32).reshape(-1, 1, 256)
    voices_path = os.path.join(out_dir, 'voices.npz')
    np.savez(voices_path, **voices)
    tts = Kokoro(os.path.join(model_dir, 'model_quantized.onnx'), voices_path)

    timing = {'sample_rate': 24000, 'voice': spec['voice'], 'scenes': {}}
    gap = float(spec['gap'])
    for scene in spec['scenes']:
        parts, lines, at = [], [], 0.0
        for spoken, subtitle in scene['lines']:
            samples, rate = tts.create(spoken, voice=spec['voice'], speed=float(spec['speed']), lang='en-us')
            assert rate == 24000, rate
            length = len(samples) / rate
            lines.append([round(at, 3), round(length, 3), subtitle])
            parts.append(samples.astype(np.float32))
            parts.append(np.zeros(int(gap * rate), dtype=np.float32))
            at += length + gap
        audio = np.concatenate(parts[:-1])
        sf.write(os.path.join(out_dir, f"{scene['id']}.wav"), audio, 24000, subtype='FLOAT')
        timing['scenes'][scene['id']] = {'voice': round(len(audio) / 24000, 3), 'lead': spec['lead'], 'tail': spec['tail'], 'lines': lines}
        print(f"{scene['id']:<11} {len(audio) / 24000:6.2f}s  {len(lines)} lines")

    json.dump(timing, open(os.path.join(out_dir, 'timing.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
