# UNITY CARRIER tutorial video

`unity-carrier-tutorial.mp4` is a 2 min 48 s video for customers (1920×1080, H.264, no sound). It shows:

1. how to create an account in the customer panel and log in;
2. how to top up in the panel, on the payment website and in Telegram;
3. where the SIP login is and how to set up a SIP app;
4. how to call from the browser with the Webphone (WebRTC);
5. the extras: Connect Telegram, two-step login and invite links.

The payment website, payment status page and the panel's Top up and Telegram & security pages are real screenshots, taken with a demo account. The MagnusBilling screens, the SIP app, the crypto checkout and the Telegram chat are simplified drawings.

## Before you publish it

These details are shown in the video. Check that they match your setup:

| Shown | Where to change it in `video.html` |
| --- | --- |
| SIP server `www.unitycarrier.com`, port `5060`, `UDP` | `SERVER` constant, and the SIP scenes |
| Dial "country code + number", e.g. 44 7700 900123 | `sipapp` and `webrtc` scenes |
| **Create an account** button on the login page | Needs **Enable Signup Form** and **Show Signup button** set to `1` in MagnusBilling |
| Plan name "Standard plan" | `signup` scene |
| "Message us to turn on WebRTC for your line" | `webrtc` scene hint |

## Narration script

The video has captions and no voice. To add a voice-over, read this out, or put it through a text-to-speech tool, and lay it over the video. Each line starts at the time shown.

| Time | Narration |
| --- | --- |
| 0:00 | Welcome to UNITY CARRIER. In the next three minutes you will create your account, top up with crypto and make your first call. |
| 0:06 | There are three steps: create your account in the customer panel, top up your balance, and call from a SIP app or straight from your browser. |
| 0:14 | Open www.unitycarrier.com/panel and tap "Create an account". Choose a username and password, fill in your details, accept the terms and tap Signup. Prefer help? Message us on Telegram and we will create it for you. |
| 0:35 | Now log in with your username and password. Your desktop has everything: Top up, SIP Users, your call history and more. |
| 0:46 | To add credit, open Top up, pick an amount and tap "Pay with crypto". On the checkout, choose a coin and send the exact amount shown. Your balance updates automatically once the payment confirms. |
| 1:08 | You can also top up on our website without logging in. Go to pay.unitycarrier.com/pay, type your username, choose an amount and continue to the secure checkout. |
| 1:22 | Or use Telegram. Open the UNITY PAY bot, send /topup, type your username, tap an amount and then Pay. The bot tells you when your credit arrives, and low-balance alerts have one-tap top-up buttons. |
| 1:37 | To make calls, you need your SIP login. Open SIP Users: your SIP username and password are there. Our server is www.unitycarrier.com, port 5060, UDP. |
| 1:49 | Install any SIP app, such as Zoiper, Linphone or MicroSIP, and add a SIP account with your SIP username, password and our server. When it shows Registered, dial the country code and the number. |
| 2:10 | No app? Call from your browser. In SIP Users, select your line and tap Webphone. Allow the microphone, dial the number and tap Call. |
| 2:28 | Finally, under Telegram & security, connect Telegram for payment messages and low-balance alerts, and turn on two-step login. Share your invite link from the Top up page and you and your friend both get bonus credit. |
| 2:41 | That's it. Happy calling! Questions? Message us on Telegram. |

## Rebuilding it

`video.html` draws every frame: `render(t)` places everything for time `t`. Open it in a browser and run `play()` in the console to watch it live. The screenshots and their button positions are in `shots/`.

Render the frames, then join them into the MP4:

```bash
node render.cjs frames /tmp/frames
```

```bash
ffmpeg -framerate 25 -i /tmp/frames/f%05d.jpg -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -tune stillimage -movflags +faststart unity-carrier-tutorial.mp4
```

To check a few moments without rendering everything, `node render.cjs stills /tmp/stills 20,60,120` saves PNG stills at those seconds.
