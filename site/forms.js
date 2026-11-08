/* Level AI — shared form, live progress, and copy-button behavior. */
(function () {
  'use strict';

  var LA = (window.LevelAI = {});
  var POLL_MS = 1500;

  /* ---------- small helpers ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgIcon(cls, d) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Server timestamps may be ISO strings, epoch ms, or epoch seconds.
  function toMs(at) {
    if (at == null || at === '') return NaN;
    if (typeof at === 'number') return at < 1e12 ? at * 1000 : at;
    if (/^\d+(\.\d+)?$/.test(String(at))) return toMs(Number(at));
    return Date.parse(at);
  }

  LA.param = function (name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  };

  function setParam(name, value) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set(name, value);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* older browsers: the page still works without it */ }
  }

  LA.getJSON = function (url) {
    return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  };

  LA.postJSON = function (url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data || {} };
      });
    });
  };

  /* ---------- validation ---------- */

  var STORE_HOSTS = ['play.google.com', 'apps.apple.com', 'itunes.apple.com'];

  function httpsUrl(value) {
    try {
      var u = new URL(value);
      return u.protocol === 'https:' && u.hostname.indexOf('.') > 0 ? u : null;
    } catch (e) { return null; }
  }

  function messageFor(input) {
    var v = input.type === 'checkbox' ? input.checked : input.value.trim();
    if (input.required && !v) return input.dataset.missing || 'Fill this in.';
    if (!v) return '';
    if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return 'Enter an email address, like you@studio.com.';
    }
    if (input.dataset.check === 'store') {
      var s = httpsUrl(v);
      if (!s || STORE_HOSTS.indexOf(s.hostname.toLowerCase()) === -1) {
        return 'Paste a link from Google Play or the App Store.';
      }
    }
    if (input.dataset.check === 'https' && !httpsUrl(v)) {
      return 'Paste a full link that starts with https://';
    }
    return '';
  }

  function showFieldError(input, msg) {
    var err = document.getElementById(input.id + '-err');
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (!err) return;
    err.textContent = msg;
    err.hidden = !msg;
  }

  function validate(form) {
    var first = null;
    form.querySelectorAll('input, textarea').forEach(function (input) {
      var msg = messageFor(input);
      showFieldError(input, msg);
      if (msg && !first) first = input;
    });
    return first;
  }

  function values(form) {
    var out = {};
    form.querySelectorAll('input[name], textarea[name]').forEach(function (input) {
      out[input.name] = input.type === 'checkbox' ? input.checked : input.value.trim();
    });
    return out;
  }

  /* ---------- form binding ---------- */
  // opts: { url, body(values) -> object, sendingLabel, onSuccess(data, values) }
  LA.bindForm = function (form, opts) {
    var button = form.querySelector('button[type="submit"]');
    var alertBox = form.querySelector('.form-alert');
    var busy = false;

    // Clear an error as soon as the person fixes it.
    form.addEventListener('input', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('aria-invalid') === 'true' && !messageFor(t)) showFieldError(t, '');
    });
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.type === 'checkbox' && t.getAttribute('aria-invalid') === 'true' && !messageFor(t)) showFieldError(t, '');
    });

    function setAlert(msg) {
      if (!alertBox) return;
      alertBox.textContent = msg || '';
      alertBox.hidden = !msg;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      setAlert('');
      var bad = validate(form);
      if (bad) { bad.focus(); return; }

      var v = values(form);
      var label = button.textContent;
      busy = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = opts.sendingLabel || 'Sending…';

      function reset() {
        busy = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = label;
      }

      LA.postJSON(opts.url, opts.body(v)).then(function (res) {
        if (res.ok && res.data.ok) {
          reset();
          opts.onSuccess(res.data, v);
          return;
        }
        reset();
        setAlert(res.data.error || 'That didn’t go through. Check your details and try again.');
        if (alertBox) alertBox.focus();
      }).catch(function () {
        reset();
        setAlert('We couldn’t reach Level AI. Check your connection and try again.');
        if (alertBox) alertBox.focus();
      });
    });

    if (opts.onReady) opts.onReady({ button: button });
  };

  /* ---------- live progress ---------- */
  // opts: { id, title, maxMs, waitingText, runningNote, doneText, failedText, timeoutText, actions: [{href, label, primary}], failedActions }
  LA.showProgress = function (mount, opts) {
    if (opts.id != null && opts.id !== '') setParam('id', opts.id);

    var panel = el('section', 'progress');
    panel.setAttribute('aria-labelledby', 'progress-title');

    var top = el('div', 'progress-top');
    var title = el('h2', null, opts.title);
    title.id = 'progress-title';
    title.tabIndex = -1;
    var elapsed = el('span', 'elapsed', '0:00');
    elapsed.setAttribute('aria-hidden', 'true');
    top.appendChild(title);
    top.appendChild(elapsed);

    var ticker = el('div', 'ticker');
    ticker.setAttribute('aria-hidden', 'true');
    for (var t = 0; t < 8; t++) {
      var tile = el('i');
      tile.style.setProperty('--i', t);
      ticker.appendChild(tile);
    }

    var list = el('ol', 'checklist');
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-label', 'Progress');

    var note = el('p', 'progress-note', opts.runningNote);
    note.setAttribute('role', 'status');

    var actions = el('div', 'progress-actions');
    actions.hidden = true;
    function setActions(list) {
      actions.innerHTML = '';
      (list || []).forEach(function (a) {
        var link = el('a', a.primary ? 'btn' : 'text-link', a.label);
        link.href = a.href;
        actions.appendChild(link);
      });
    }
    setActions(opts.actions);

    panel.appendChild(top);
    panel.appendChild(ticker);
    panel.appendChild(list);
    panel.appendChild(note);
    panel.appendChild(actions);

    mount.innerHTML = '';
    mount.appendChild(panel);

    var rect = panel.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.6) {
      panel.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    title.focus({ preventScroll: true });

    /* rows */
    var rows = [];
    var placeholder = null;

    function makeRow(isNew) {
      var li = el('li', 'check-item' + (isNew ? ' is-new' : ''));
      var tileEl = el('span', 'check-tile');
      tileEl.setAttribute('aria-hidden', 'true');
      tileEl.appendChild(svgIcon('i-done', 'M5.5 12.5l4.2 4.2L18.5 7.8'));
      tileEl.appendChild(svgIcon('i-failed', 'M7 7l10 10M17 7L7 17'));
      var label = el('span', 'check-text');
      var sr = el('span', 'sr');
      var text = document.createTextNode('');
      label.appendChild(sr);
      label.appendChild(text);
      var time = el('span', 'check-time');
      time.setAttribute('aria-hidden', 'true');
      li.appendChild(tileEl);
      li.appendChild(label);
      li.appendChild(time);
      return { li: li, sr: sr, text: text, time: time, state: '', value: null };
    }

    function setRow(row, text, state, timeText) {
      if (row.value !== text) { row.text.nodeValue = text; row.value = text; }
      if (row.state !== state) {
        row.li.classList.remove('is-done', 'is-active', 'is-failed');
        if (state) row.li.classList.add('is-' + state);
        row.sr.textContent = state === 'done' ? 'Done: ' : state === 'failed' ? 'Didn’t work: ' : 'In progress: ';
        row.state = state;
      }
      if (row.time.textContent !== timeText) row.time.textContent = timeText;
    }

    function showPlaceholder() {
      if (placeholder || rows.length) return;
      placeholder = makeRow(false);
      setRow(placeholder, opts.waitingText || 'Getting started…', 'active', '');
      list.appendChild(placeholder.li);
    }

    function render(steps) {
      if (!Array.isArray(steps)) steps = [];
      if (steps.length && placeholder) { placeholder.li.remove(); placeholder = null; }
      if (!steps.length) { showPlaceholder(); return; }
      var t0 = toMs(steps[0] && steps[0].at);
      steps.forEach(function (step, i) {
        var row = rows[i];
        if (!row) {
          row = makeRow(true);
          rows.push(row);
          list.appendChild(row.li);
        }
        var state = step.state === 'done' || step.state === 'failed' ? step.state : 'active';
        var ti = toMs(step.at);
        var timeText = isNaN(ti) || isNaN(t0) ? '' : clock(ti - t0);
        setRow(row, String(step.text == null ? '' : step.text), state, timeText);
      });
      while (rows.length > steps.length) rows.pop().li.remove();
    }

    /* polling */
    var started = Date.now();
    var stopped = false;
    var failures = 0;
    var pollTimer = null;
    var clockTimer = setInterval(function () { elapsed.textContent = clock(Date.now() - started); }, 1000);

    function finish(kind) {
      if (stopped) return;
      stopped = true;
      clearTimeout(pollTimer);
      clearInterval(clockTimer);
      panel.classList.add('is-finished', 'pg-' + kind);
      note.textContent = kind === 'ok' ? opts.doneText : kind === 'failed' ? opts.failedText : opts.timeoutText;
      // A failed run can offer a different next step (the join page offers emailing us instead).
      if ((kind === 'failed' || kind === 'timeout') && opts.failedActions) setActions(opts.failedActions);
      // An unfinished step should stop looking busy once we stop watching.
      if (placeholder) { placeholder.li.remove(); placeholder = null; }
      actions.hidden = !actions.children.length;
    }

    function poll() {
      if (stopped) return;
      if (Date.now() - started > opts.maxMs) { finish('timeout'); return; }
      LA.getJSON('/signup-status?id=' + encodeURIComponent(opts.id)).then(function (data) {
        if (stopped) return;
        failures = 0;
        var steps = (data && data.steps) || [];
        render(steps);
        if (data && data.done) {
          var failed = steps.some(function (s) { return s && s.state === 'failed'; });
          finish(failed ? 'failed' : 'ok');
          return;
        }
        if (note.textContent !== opts.runningNote) note.textContent = opts.runningNote;
        pollTimer = setTimeout(poll, POLL_MS);
      }).catch(function () {
        if (stopped) return;
        failures++;
        if (failures >= 4) note.textContent = 'Still working. This page lost its connection for a moment and will keep trying.';
        pollTimer = setTimeout(poll, POLL_MS);
      });
    }

    showPlaceholder();
    // No id to watch: confirm receipt and stop.
    if (opts.id == null || opts.id === '') {
      finish('ok');
      note.textContent = opts.receivedText || 'Got it. We’ll email you soon.';
      return;
    }
    poll();
  };

  /* ---------- copy buttons ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  LA.bindCopyButtons = function () {
    var live = el('p', 'sr');
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);

    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      var label = btn.querySelector('.copy-label');
      var original = label ? label.textContent : '';
      var resetTimer = null;
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.getAttribute('data-copy'));
        if (!target) return;
        copyText(target.textContent.trim()).then(function () {
          btn.classList.add('is-copied');
          if (label) label.textContent = 'Copied';
          live.textContent = 'Copied to your clipboard.';
        }).catch(function () {
          if (label) label.textContent = 'Select and copy';
          live.textContent = 'Couldn’t copy. Select the text and copy it yourself.';
        }).then(function () {
          clearTimeout(resetTimer);
          resetTimer = setTimeout(function () {
            btn.classList.remove('is-copied');
            if (label) label.textContent = original;
            live.textContent = '';
          }, 2200);
        });
      });
    });
  };
})();
