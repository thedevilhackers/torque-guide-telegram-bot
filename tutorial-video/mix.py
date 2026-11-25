"""
Lays the per-scene voice-over (narrate.py) on the final video timeline (render.cjs writes timeline.json) and writes
English subtitles.

    python mix.py VOICE_DIR TIMELINE_JSON OUT_DIR   ->  OUT_DIR/narration.wav, OUT_DIR/unity-carrier-tutorial.en.srt
"""
import json
import os
import sys

import numpy as np
import soundfile as sf


def stamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main(voice_dir: str, timeline_path: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    timing = json.load(open(os.path.join(voice_dir, 'timing.json'), encoding='utf-8'))
    timeline = json.load(open(timeline_path, encoding='utf-8'))
    rate = timing['sample_rate']
    total = timeline[-1]['start'] + timeline[-1]['dur']
    track = np.zeros(int(total * rate) + rate, dtype=np.float32)

    cues = []
    for scene in timeline:
        info = timing['scenes'].get(scene['id'])
        if info is None:
            continue
        audio, r = sf.read(os.path.join(voice_dir, scene['id'] + '.wav'), dtype='float32')
        assert r == rate
        begin = scene['start'] + info['lead']
        if begin + info['voice'] > scene['start'] + scene['dur'] + 1e-3:
            raise SystemExit(f"{scene['id']}: narration runs past the end of the scene")
        at = int(begin * rate)
        track[at:at + len(audio)] += audio
        for line_start, length, text in info['lines']:
            cues.append([begin + line_start, begin + line_start + length, text])

    peak = float(np.abs(track).max())
    if peak > 0.98:
        track *= 0.98 / peak
    sf.write(os.path.join(out_dir, 'narration.wav'), track[:int(total * rate)], rate, subtype='PCM_16')

    with open(os.path.join(out_dir, 'unity-carrier-tutorial.en.srt'), 'w', encoding='utf-8') as srt:
        for i, (start, end, text) in enumerate(cues):
            # keep each line on screen a little longer, but never over the next one
            linger = min(end + 0.4, cues[i + 1][0] - 0.05) if i + 1 < len(cues) else end + 0.6
            srt.write(f"{i + 1}\n{stamp(start)} --> {stamp(max(end, linger))}\n{text}\n\n")
    print(f"narration.wav {total:.2f}s, {len(cues)} subtitles, peak {peak:.2f}")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
