# UNITY CARRIER tutorial video

`unity-carrier-tutorial.mp4` is a 2 min 56 s video for customers. It is 1920×1080 H.264, with an **English voice-over** and **English subtitles**: built into the MP4 (switch them on in the player) and as `unity-carrier-tutorial.en.srt` for YouTube and similar sites. It shows:

1. how to create an account in the customer panel and log in;
2. how to top up in the panel, on the payment website and in Telegram;
3. where the SIP login is and how to set up a SIP app;
4. how to call from the browser with the Webphone (WebRTC);
5. the extras: Connect Telegram, two-step login and invite links.

The payment website, payment status page and the panel's Top up and Telegram & security pages are real screenshots, taken with a demo account. The MagnusBilling screens, the SIP app, the crypto checkout and the Telegram chat are simplified drawings.

The voice is **Kokoro-82M** (voice `af_heart`, US English), an open model under the Apache-2.0 licence, run offline with [kokoro-onnx](https://pypi.org/project/kokoro-onnx/). It may be used in commercial videos.

## Before you publish it

These details are shown in the video. Check that they match your setup:

| Shown | Where to change it in `video.html` |
| --- | --- |
| SIP server `www.unitycarrier.com`, port `5060`, `UDP` | `SERVER` constant, and the SIP scenes |
| Dial "country code + number", e.g. 44 7700 900123 | `sipapp` and `webrtc` scenes |
| **Create an account** button on the login page | Needs **Enable Signup Form** and **Show Signup button** set to `1` in MagnusBilling |
| Plan name "Standard plan" | `signup` scene |
| "Message us to turn on WebRTC for your line" | `webrtc` scene hint |

## Narration

The spoken text is in `narration.json`. Each line is a pair: what the voice says (written the way it should sound, for example "unity carrier dot com, slash panel"), and the subtitle text. Change a line there and rebuild. A scene gets longer by itself if its narration needs more time.

## Rebuilding it

`video.html` draws every frame: `render(t)` places everything for time `t`. Open it in a browser and run `play()` in the console to watch it live. The screenshots and their button positions are in `shots/`.

1. **Voice:** needs Python with `kokoro-onnx` and `soundfile`, plus a folder with Kokoro-82M `model_quantized.onnx` and the voice file `af_heart.bin` (from the `kokoro-js` npm package):

   ```bash
   python narrate.py MODEL_DIR voice
   ```

2. **Frames:** scene lengths follow the voice timing:

   ```bash
   VOICE_TIMING=voice/timing.json node render.cjs frames frames
   ```

3. **Narration track and subtitles:**

   ```bash
   python mix.py voice frames/timeline.json mix
   ```

4. **MP4:**

   ```bash
   ffmpeg -framerate 25 -i frames/f%05d.jpg -i mix/narration.wav -i mix/unity-carrier-tutorial.en.srt -map 0:v -map 1:a -map 2:s -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -tune stillimage -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000" -c:a aac -b:a 160k -c:s mov_text -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng -movflags +faststart unity-carrier-tutorial.mp4
   ```

To check a few moments without rendering everything, `node render.cjs stills stills 20,60,120` saves PNG stills at those seconds.
