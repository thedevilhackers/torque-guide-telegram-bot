/* Customer-panel add-on: top-up, Connect Telegram and two-step login. */
(function () {
    'use strict';

    var configEl = document.getElementById('panel-config');
    var cfg = configEl ? JSON.parse(configEl.textContent || '{}') : {};
    if (!cfg.csrf) {
        return; // not logged in: nothing to wire up
    }

    function $(id) {
        return document.getElementById(id);
    }

    function post(action, data) {
        data = data || {};
        data.action = action;
        return fetch(window.location.pathname, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cfg.csrf },
            body: JSON.stringify(data)
        }).then(function (res) {
            return res.json().catch(function () {
                return { ok: false, error: { message: 'Unexpected answer from the server. Please try again.' } };
            });
        }, function () {
            return { ok: false, error: { message: 'No connection. Check your internet and try again.' } };
        }).then(function (json) {
            if (!json.ok) {
                throw new Error((json.error && json.error.message) || 'Something went wrong. Please try again.');
            }
            return json.data;
        });
    }

    function say(el, text, kind, link) {
        if (!el) return;
        el.textContent = text;
        if (link) {
            var a = document.createElement('a');
            a.href = link.href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = link.text;
            el.appendChild(document.createTextNode(' '));
            el.appendChild(a);
        }
        el.className = 'msg' + (kind ? ' ' + kind : '');
        el.hidden = false;
    }

    // Opens a tab during the click itself (browsers block tabs opened later), then points it at $url.
    function pendingTab(text) {
        var win = null;
        try {
            win = window.open('', '_blank');
            if (win) {
                win.document.write('<!doctype html><title>Opening…</title><p style="font:16px system-ui,sans-serif;padding:24px">' + text + '</p>');
            }
        } catch (e) {
            win = null;
        }
        return win;
    }

    function finishTab(win, url) {
        if (win && !win.closed) {
            try { win.opener = null; } catch (e) { /* ignore */ }
            win.location.href = url;
            return true;
        }
        return false;
    }

    function closeTab(win) {
        if (win && !win.closed) {
            try { win.close(); } catch (e) { /* ignore */ }
        }
    }

    function busy(button, on, label) {
        if (!button) return;
        if (on) {
            button.dataset.label = button.textContent;
            button.textContent = label || 'Please wait…';
        } else if (button.dataset.label) {
            button.textContent = button.dataset.label;
        }
        button.disabled = on;
    }

    // ------------------------------------------------------------------ top-up

    var topup = $('topup');
    if (topup) {
        var amount = $('amount');
        Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
            chip.addEventListener('click', function () {
                amount.value = chip.getAttribute('data-amount');
                Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
                    c.classList.toggle('on', c === chip);
                });
            });
        });
        amount.addEventListener('input', function () {
            Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
                c.classList.toggle('on', c.getAttribute('data-amount') === amount.value);
            });
        });

        topup.addEventListener('submit', function (ev) {
            ev.preventDefault();
            var msg = $('topup-msg');
            var value = parseFloat(String(amount.value).replace(',', '.').replace(/[^0-9.]/g, ''));
            if (!(value >= cfg.min && value <= cfg.max)) {
                say(msg, 'Enter an amount from ' + cfg.symbol + cfg.min.toFixed(2) + ' to ' + cfg.symbol + cfg.max.toFixed(2) + '.', 'err');
                amount.focus();
                return;
            }
            var button = $('pay');
            var win = pendingTab('Opening the payment page…');
            busy(button, true, 'Creating payment…');
            post('topup', { amount: value.toFixed(2), promo: ($('promo') && $('promo').value) || '' }).then(function (data) {
                var opened = finishTab(win, data.payment_url);
                say(
                    msg,
                    opened ? 'The payment page opened in a new tab. Your balance updates automatically once the payment confirms.'
                        : 'Your payment is ready.',
                    'ok',
                    opened ? { href: data.status_url, text: 'Payment status' } : { href: data.payment_url, text: 'Open the payment page' }
                );
            }).catch(function (err) {
                closeTab(win);
                say(msg, err.message, 'err');
            }).then(function () {
                busy(button, false);
            });
        });
    }

    // ---------------------------------------------------------------- telegram

    var tg = $('tg');
    if (tg) {
        tg.addEventListener('click', function () {
            var msg = $('tg-msg');
            var win = pendingTab('Opening Telegram…');
            busy(tg, true);
            post('telegram').then(function (data) {
                var opened = finishTab(win, data.link);
                say(
                    msg,
                    opened ? 'Telegram opened. Press Start in the chat to finish, then reload this page.'
                        : 'Your link is ready. Open it and press Start in Telegram.',
                    'ok',
                    { href: data.link, text: opened ? 'Open the link again' : 'Open Telegram' }
                );
            }).catch(function (err) {
                closeTab(win);
                say(msg, err.message, 'err');
            }).then(function () {
                busy(tg, false);
            });
        });
    }

    // ---------------------------------------------------------- two-step login

    var tsStart = $('ts-start');
    var tsMsg = $('ts-msg');

    function setTwoStep(on) {
        $('ts-off').hidden = on;
        $('ts-on').hidden = !on;
        $('ts-setup').hidden = true;
        tsStart.hidden = false;
        var badge = $('ts-badge');
        badge.textContent = on ? 'On' : 'Off';
        badge.className = 'badge ' + (on ? 'ok' : 'warn');
    }

    if (tsStart) {
        tsStart.addEventListener('click', function () {
            busy(tsStart, true);
            post('twostep_start').then(function (data) {
                var box = $('ts-qr');
                box.textContent = '';
                if (typeof window.qrcode === 'function') {
                    var qr = window.qrcode(0, 'M');
                    qr.addData(data.uri);
                    qr.make();
                    box.innerHTML = qr.createSvgTag(5, 8);
                }
                $('ts-secret').textContent = data.secret.replace(/(.{4})/g, '$1 ').trim();
                $('ts-setup').hidden = false;
                tsStart.hidden = true;
                tsMsg.hidden = true;
                $('ts-code').focus();
            }).catch(function (err) {
                say(tsMsg, err.message, 'err');
            }).then(function () {
                busy(tsStart, false);
            });
        });

        $('ts-confirm').addEventListener('submit', function (ev) {
            ev.preventDefault();
            var button = ev.target.querySelector('button');
            busy(button, true, 'Checking…');
            post('twostep_confirm', { code: $('ts-code').value }).then(function () {
                setTwoStep(true);
                $('ts-code').value = '';
                say(tsMsg, 'Two-step login is on. From your next login you will be asked for the code from your app.', 'ok');
            }).catch(function (err) {
                say(tsMsg, err.message, 'err');
            }).then(function () {
                busy(button, false);
            });
        });

        $('ts-disable').addEventListener('submit', function (ev) {
            ev.preventDefault();
            var button = ev.target.querySelector('button');
            busy(button, true, 'Checking…');
            post('twostep_disable', { code: $('ts-off-code').value }).then(function () {
                setTwoStep(false);
                $('ts-off-code').value = '';
                say(tsMsg, 'Two-step login is off. Your account is protected by your password only.', 'warn');
            }).catch(function (err) {
                say(tsMsg, err.message, 'err');
            }).then(function () {
                busy(button, false);
            });
        });
    }
}());
