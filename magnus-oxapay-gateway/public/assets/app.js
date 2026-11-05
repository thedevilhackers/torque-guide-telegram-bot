(function () {
    'use strict';

    var cfgEl = document.getElementById('gateway-config');
    var cfg = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};
    var pay = cfg.payments || {};
    var USERNAME_RE = /^[A-Za-z0-9_.@+\-]{1,64}$/;
    var AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;

    var STORAGE_KEY = 'gateway.username';

    function remember(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* storage unavailable */ }
    }

    function recall() {
        try { return window.localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
    }

    function api(action, params, body) {
        var url = 'api.php?action=' + encodeURIComponent(action);
        Object.keys(params || {}).forEach(function (key) {
            url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
        });
        var options = { headers: { Accept: 'application/json' } };
        if (body) {
            options.method = 'POST';
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        return fetch(url, options)
            .then(function (response) { return response.json(); })
            .catch(function () {
                return { ok: false, error: { code: 'network', message: 'Could not reach the server. Check your connection and try again.' } };
            });
    }

    function money(value) {
        var text = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return pay.currency_symbol ? pay.currency_symbol + text : text + ' ' + (pay.currency || '');
    }

    function creditText(value) {
        return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

    function parseAmount(raw) {
        var text = String(raw || '').replace(/,/g, '.').replace(/\s/g, '');
        return AMOUNT_RE.test(text) ? Math.round(parseFloat(text) * 100) / 100 : null;
    }

    var promo = { code: '', percent: 0 };

    function quote(amount) {
        var bonus = promo.percent || 0;
        var tierBonus = 0;
        (pay.bonus || []).forEach(function (tier) {
            if (tier && amount >= Number(tier.min)) {
                tierBonus = Math.max(tierBonus, Number(tier.percent) || 0);
            }
        });
        bonus += tierBonus;
        var rate = Number(pay.credit_rate) || 1;
        return { bonus: bonus, credit: Math.round(amount * rate * (1 + bonus / 100) * 10000) / 10000 };
    }

    // ------------------------------------------------------------ top-up form

    function initForm(form) {
        var username = document.getElementById('username');
        var badge = document.getElementById('user-badge');
        var userHint = document.getElementById('username-hint');
        var userHintDefault = userHint.textContent;
        var amount = document.getElementById('amount');
        var email = document.getElementById('email');
        var presets = Array.prototype.slice.call(document.querySelectorAll('.preset'));
        var summary = document.getElementById('summary');
        var error = document.getElementById('form-error');
        var submit = document.getElementById('submit');

        var check = { value: '', exists: null, seq: 0 };
        var timer = null;

        function setBadge(kind, text) {
            badge.className = 'badge ' + kind;
            badge.textContent = text;
            badge.hidden = !text;
        }

        function setUserHint(kind, text) {
            userHint.className = 'hint' + (kind ? ' ' + kind : '');
            userHint.textContent = text || userHintDefault;
        }

        function checkUser() {
            var value = username.value.trim();
            if (!value) {
                setBadge('', '');
                setUserHint('', '');
                check = { value: '', exists: null, seq: check.seq + 1 };
                return;
            }
            if (!USERNAME_RE.test(value)) {
                setBadge('bad', 'Invalid');
                setUserHint('bad', 'Use letters, numbers and . _ - @ + only.');
                return;
            }
            if (value === check.value && check.exists !== null) {
                return;
            }
            var seq = ++check.seq;
            check.value = value;
            check.exists = null;
            setBadge('wait', 'Checking…');
            api('check_user', { username: value }).then(function (res) {
                if (seq !== check.seq) {
                    return;
                }
                if (res.ok) {
                    check.exists = !!res.data.exists;
                    updateSteps();
                    setBadge(check.exists ? 'ok' : 'bad', check.exists ? 'Found' : 'Not found');
                    setUserHint(check.exists ? 'ok' : 'bad', check.exists ? 'Account found.' : 'No account with this username. Check for typos.');
                } else {
                    setBadge('', '');
                    setUserHint(res.error && res.error.code === 'rate_limited' ? 'bad' : '', res.error ? res.error.message : '');
                }
            });
        }

        var steps = Array.prototype.slice.call(document.querySelectorAll('.steps li'));
        function updateSteps() {
            if (!steps.length) {
                return;
            }
            var hasUser = check.exists === true;
            var value = parseAmount(amount.value);
            var hasAmount = value !== null && value >= pay.min_amount && value <= pay.max_amount;
            var state = [hasUser ? 'done' : 'on', hasUser ? (hasAmount ? 'done' : 'on') : '', hasUser && hasAmount ? 'on' : ''];
            steps.forEach(function (step, index) {
                step.className = state[index];
            });
        }

        function updateAmount() {
            updateSteps();
            var value = parseAmount(amount.value);
            presets.forEach(function (button) {
                button.setAttribute('aria-pressed', value !== null && Number(button.dataset.amount) === value ? 'true' : 'false');
            });
            if (value === null || value <= 0) {
                summary.hidden = true;
                return;
            }
            var q = quote(value);
            document.getElementById('sum-pay').textContent = money(value);
            document.getElementById('sum-credit').textContent = creditText(q.credit);
            document.getElementById('sum-bonus-row').hidden = q.bonus <= 0;
            document.getElementById('sum-bonus').textContent = '+' + q.bonus + '%';
            summary.hidden = false;
        }

        function showError(message) {
            error.textContent = message;
            error.hidden = !message;
        }

        username.addEventListener('input', function () {
            showError('');
            clearTimeout(timer);
            timer = setTimeout(checkUser, 550);
        });
        username.addEventListener('blur', function () {
            clearTimeout(timer);
            checkUser();
        });

        amount.addEventListener('input', function () {
            showError('');
            amount.parentNode.classList.remove('invalid');
            updateAmount();
        });

        presets.forEach(function (button) {
            button.addEventListener('click', function () {
                amount.value = button.dataset.amount;
                amount.parentNode.classList.remove('invalid');
                showError('');
                updateAmount();
            });
        });

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            showError('');

            var user = username.value.trim();
            var value = parseAmount(amount.value);
            if (!USERNAME_RE.test(user)) {
                username.parentNode.classList.add('invalid');
                username.focus();
                return showError('Enter your account username.');
            }
            username.parentNode.classList.remove('invalid');
            if (check.value === user && check.exists === false) {
                username.focus();
                return showError('No account found with that username.');
            }
            if (value === null || value < pay.min_amount || value > pay.max_amount) {
                amount.parentNode.classList.add('invalid');
                amount.focus();
                return showError('Enter an amount between ' + money(pay.min_amount) + ' and ' + money(pay.max_amount) + '.');
            }

            submit.disabled = true;
            submit.classList.add('loading');
            submit.querySelector('.btn-label').textContent = 'Creating secure payment…';
            remember(user);

            api('create_payment', null, {
                username: user,
                amount: value.toFixed(2),
                promo: promo.code,
                email: email ? email.value.trim() : ''
            }).then(function (res) {
                if (res.ok && res.data && res.data.payment_url) {
                    submit.querySelector('.btn-label').textContent = 'Redirecting to OxaPay…';
                    window.location.href = res.data.payment_url;
                    return;
                }
                submit.disabled = false;
                submit.classList.remove('loading');
                submit.querySelector('.btn-label').textContent = 'Continue to secure payment';
                showError(res.error ? res.error.message : 'Something went wrong. Please try again.');
            });
        });

        // Restore the button if the visitor comes back from OxaPay with the browser's back button.
        window.addEventListener('pageshow', function (event) {
            if (event.persisted) {
                submit.disabled = false;
                submit.classList.remove('loading');
                submit.querySelector('.btn-label').textContent = 'Continue to secure payment';
            }
        });

        var promoInput = document.getElementById('promo');
        var promoHint = document.getElementById('promo-hint');
        function applyPromo() {
            var code = promoInput.value.trim().toUpperCase();
            promoInput.value = code;
            if (!code) {
                promo = { code: '', percent: 0 };
                promoHint.hidden = true;
                updateAmount();
                return;
            }
            api('promo', { code: code }).then(function (res) {
                if (res.ok) {
                    promo = { code: res.data.code, percent: Number(res.data.percent) || 0 };
                    promoHint.className = 'hint ok';
                    promoHint.textContent = '✓ ' + res.data.code + ': +' + promo.percent + '% extra credit';
                } else {
                    promo = { code: '', percent: 0 };
                    promoHint.className = 'hint bad';
                    promoHint.textContent = res.error ? res.error.message : 'That code is not valid.';
                }
                promoHint.hidden = false;
                updateAmount();
            });
        }
        if (promoInput) {
            document.getElementById('promo-apply').addEventListener('click', applyPromo);
            promoInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    applyPromo();
                }
            });
            if (promoInput.value) {
                applyPromo();
            }
        }

        if (!username.value) {
            username.value = recall();
        }
        if (username.value) {
            checkUser();
        }
        updateAmount();
    }

    // ------------------------------------------------------------ status page

    var NOTES = {
        new: 'Complete the payment on the OxaPay page. This page updates by itself.',
        pending: 'Complete the payment on the OxaPay page. This page updates by itself.',
        paying: 'We can see your payment. Waiting for network confirmations, which usually takes a few minutes.',
        crediting: 'Payment confirmed. Adding credit to your account…',
        credit_failed: 'Your payment was received and the credit is being added. If it does not appear within 15 minutes, contact support with the order ID.',
        review: 'Your payment was received and is being checked by our team. Contact support with the order ID if you have questions.',
        expired: 'This payment link has expired. If you already sent funds, contact support with the order ID.',
        underpaid: 'The amount received was lower than the invoice. Contact support with the order ID.',
        refunded: 'This payment was refunded.',
        failed: 'The payment could not be started. Please try again.'
    };

    function initTrack(form) {
        var input = document.getElementById('track-id');
        var error = document.getElementById('track-error');
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var id = input.value.trim().toLowerCase();
            if (!/^[a-f0-9]{24}$/.test(id)) {
                error.className = 'hint bad';
                error.textContent = 'An order ID is 24 letters and numbers, for example 1c8243d0f76d7786e4b9e72c.';
                error.hidden = false;
                return;
            }
            window.location.href = 'status.php?order=' + encodeURIComponent(id);
        });
    }

    function initStatus(view) {
        var dataEl = document.getElementById('order-data');
        var order = dataEl ? JSON.parse(dataEl.textContent || '{}') : null;
        if (!order) {
            return;
        }
        var started = Date.now();

        var countdown = document.getElementById('st-countdown');
        var timer = null;

        function tick() {
            var left = order.expires_at ? order.expires_at * 1000 - Date.now() : 0;
            var open = order.status === 'pending' || order.status === 'new';
            if (!open || !order.expires_at) {
                countdown.hidden = true;
                return;
            }
            if (left <= 0) {
                countdown.innerHTML = 'The payment link has expired';
                countdown.hidden = false;
                return;
            }
            var minutes = Math.floor(left / 60000);
            var seconds = Math.floor((left % 60000) / 1000);
            countdown.innerHTML = 'Link valid for <strong>' + minutes + ':' + (seconds < 10 ? '0' : '') + seconds + '</strong>';
            countdown.hidden = false;
        }

        var copyButton = document.getElementById('copy-order');
        if (copyButton) {
            copyButton.addEventListener('click', function () {
                var text = order.order_id;
                var done = function () {
                    copyButton.classList.add('done');
                    copyButton.setAttribute('title', 'Copied');
                    setTimeout(function () { copyButton.classList.remove('done'); }, 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, function () {});
                } else {
                    var area = document.createElement('textarea');
                    area.value = text;
                    document.body.appendChild(area);
                    area.select();
                    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
                    document.body.removeChild(area);
                }
            });
        }

        var printButton = document.getElementById('st-print');
        if (printButton) {
            printButton.addEventListener('click', function () { window.print(); });
        }

        function render(o) {
            view.setAttribute('data-status', o.status);
            document.getElementById('st-title').textContent = o.status_label;
            document.getElementById('st-note').textContent = o.status === 'credited'
                ? creditText(o.credit) + ' credit was added to ' + o.username + '. Thank you!'
                : (NOTES[o.status] || '');
            var payButton = document.getElementById('st-pay');
            if (o.payment_url) {
                payButton.href = o.payment_url;
                payButton.hidden = false;
            } else {
                payButton.hidden = true;
            }
            var telegram = document.getElementById('st-telegram');
            if (telegram) {
                telegram.hidden = !!o.is_final;
            }
            if (printButton) {
                printButton.hidden = o.status !== 'credited';
            }
            var date = document.getElementById('st-date');
            if (date && o.credited_at && String(o.credited_at) !== date.getAttribute('data-ts')) {
                // Same format the server uses: "04 Nov 2026, 03:38"
                var d = new Date(o.credited_at * 1000);
                var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                var pad = function (n) { return (n < 10 ? '0' : '') + n; };
                date.textContent = pad(d.getDate()) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                date.setAttribute('data-ts', String(o.credited_at));
            }
            tick();
        }

        function poll() {
            if (order.is_final || Date.now() - started > 2 * 3600 * 1000) {
                return;
            }
            var delay = Date.now() - started < 120000 ? 5000 : 15000;
            setTimeout(function () {
                api('order', { order_id: order.order_id }).then(function (res) {
                    if (res.ok) {
                        order = res.data;
                        render(order);
                    }
                    poll();
                });
            }, delay);
        }

        render(order);
        timer = setInterval(tick, 1000);
        poll();
    }

    var form = document.getElementById('topup-form');
    if (form) {
        initForm(form);
    }
    var trackForm = document.getElementById('track-form');
    if (trackForm) {
        initTrack(trackForm);
    }
    var statusView = document.getElementById('status-view');
    if (statusView) {
        initStatus(statusView);
    }
})();
