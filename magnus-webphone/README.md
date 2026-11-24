# MagnusBilling 8 Webphone fix

Fixes this MagnusBilling 8 error:

> **Unable to connect to WSS. Check the certificate, domain and port 8089.**

## Why it happens

When you click **Webphone** in the SIP users list, MagnusBilling runs these checks in order:

1. The page is open over HTTPS, with a domain name rather than an IP address.
2. The SIP account has **WebRTC = yes**.
3. Asterisk has the WebSocket modules loaded and HTTPS listening on port 8089 with a `/ws` endpoint.
4. Your browser opens `wss://<the domain in the address bar>:8089/ws`.

That error means checks 1 to 3 passed and check 4 failed. Asterisk is listening, but the browser cannot reach it, or does not trust its certificate. The usual causes are:

- **Port 8089 is closed.** The MagnusBilling 8 installer opens only 22, 80, 443, 5060/udp and 10000–20000/udp in firewalld.
- **The certificate is wrong.** It may be self-signed, issued for another name, or missing its intermediate certificate (`cert.pem` instead of `fullchain.pem`).
- **The domain goes through the Cloudflare proxy (orange cloud).** Cloudflare does not pass port 8089.

There are two more steps that MagnusBilling does not do for you. A browser can only register over a **PJSIP WSS transport**, and calls need Asterisk's **SRTP** module (`res_srtp`).

## One command

Run this as root on the MagnusBilling server. Use the domain you open MagnusBilling with, for example `pay.unitycarrier.com` if you open `https://pay.unitycarrier.com/mbilling`:

```bash
bash setup.sh --domain pay.unitycarrier.com --check
```

`--check` only reports problems. To fix them, run the same command without `--check`:

```bash
bash setup.sh --domain pay.unitycarrier.com
```

The script asks before changing anything. Then it:

1. Uses the Let's Encrypt certificate for that domain, or the one an Apache site already uses. If neither exists, it requests one.
2. Copies the certificate to `/etc/asterisk/keys/webphone.crt` and `webphone.key`, readable by the `asterisk` user. It adds a renewal hook so Asterisk gets each renewed certificate automatically.
3. Sets HTTPS on `0.0.0.0:8089` in `/etc/asterisk/http.conf`. Plain HTTP on 8088 stays private.
4. Adds a `[transport-wss]` section to `/etc/asterisk/pjsip.conf` if there is no WSS transport yet.
5. Loads `res_http_websocket`, `res_pjsip_transport_websocket` and `res_srtp`.
6. Opens TCP 8089 in firewalld or ufw.
7. Reloads Asterisk, which does not end calls in progress, then checks everything again.

Each file it changes is first saved as `<file>.bak-<date>`. You can run it again safely.

Options:

| Option | What it does |
| --- | --- |
| `--check` | Report only. Nothing is changed. |
| `--yes` | Do not ask before fixing. |
| `--email you@example.com` | Email for Let's Encrypt, if a new certificate is needed. |
| `--restart-asterisk` | Restart Asterisk if a reload does not start the WSS transport. This ends calls in progress. |

## Then test it

1. In your browser, open `https://<domain>:8089/ws`. You should get a page that says **Upgrade Required**. That means the port and the certificate both work.
   - If the page times out, port 8089 is blocked by your hosting provider's firewall or security group. Allow TCP 8089 there.
   - If you see a certificate warning, the certificate is not valid for that domain.
2. Open MagnusBilling at `https://<domain>/mbilling` (the same domain), then press **Ctrl+F5**.
3. Select a SIP user with **WebRTC = yes** and click **Webphone**. Allow the microphone when the browser asks.

SIP accounts used with the Webphone need the `opus`, `alaw` or `ulaw` codec. G.729 and GSM do not work in browsers.

## Doing it by hand

Replace `DOMAIN` with your domain.

```bash
firewall-cmd --permanent --zone=public --add-port=8089/tcp && firewall-cmd --reload
```

```bash
install -d -o asterisk -g asterisk /etc/asterisk/keys
install -m 0640 -o asterisk -g asterisk /etc/letsencrypt/live/DOMAIN/fullchain.pem /etc/asterisk/keys/webphone.crt
install -m 0600 -o asterisk -g asterisk /etc/letsencrypt/live/DOMAIN/privkey.pem /etc/asterisk/keys/webphone.key
```

In `/etc/asterisk/http.conf`, under `[general]`:

```ini
enabled=yes
bindaddr=127.0.0.1
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/webphone.crt
tlsprivatekey=/etc/asterisk/keys/webphone.key
```

At the end of `/etc/asterisk/pjsip.conf`:

```ini
[transport-wss]
type = transport
protocol = wss
bind = 0.0.0.0
```

Then reload and check:

```bash
asterisk -rx "module reload http"
asterisk -rx "pjsip reload"
asterisk -rx "pjsip show transports"
asterisk -rx "module show like res_srtp"
```

`pjsip show transports` should list a `wss` transport. If it does not, run `systemctl restart asterisk` at a quiet time. `res_srtp.so` should show as **Running**.

Let's Encrypt renews certificates about every 60 days. If you copy the files by hand, copy them again after each renewal. The script adds a hook that does this for you.

## If res_srtp is missing

If `module show like res_srtp` finds nothing, Asterisk was built without SRTP. The Webphone can then register, but calls fail. To fix it, rebuild Asterisk with SRTP support:

```bash
apt-get install -y libsrtp2-dev
```

```bash
cd /usr/src/asterisk-20.9.2 && ./configure --with-jansson-bundled --with-pjproject-bundled && make && make install
```

Then restart Asterisk at a quiet time:

```bash
systemctl restart asterisk
```
