/* Level AI — sticky header state and the phone menu. Loaded on every page. */
(function () {
  'use strict';
  var header = document.querySelector('.site-header');
  if (!header) return;

  function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 4); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  var btn = header.querySelector('.menu-btn');
  var menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  function setOpen(open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    header.classList.toggle('is-open', open);
  }

  btn.addEventListener('click', function () { setOpen(btn.getAttribute('aria-expanded') !== 'true'); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !header.contains(e.target)) setOpen(false);
  });
  var wide = window.matchMedia('(min-width: 900px)');
  var onWide = function (m) { if (m.matches) setOpen(false); };
  if (wide.addEventListener) wide.addEventListener('change', onWide); else wide.addListener(onWide);
})();

/* Level AI — "What players are saying right now": live counts from the agents' reads of the store charts. */
(function () {
  'use strict';
  var section = document.getElementById('players');
  if (!section || !window.fetch) return;
  var main = document.getElementById('rs-main');
  var empty = document.getElementById('rs-empty');
  var KINDS = [
    ['tooHard', 'Too hard', 'var(--tomato)'],
    ['tooEasy', 'Too easy', 'var(--sun)'],
    ['wantsMoreLevels', 'Want more levels', 'var(--cobalt)'],
    ['repetitive', 'Repetitive', 'var(--grape)']
  ];

  function n(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : 0; }
  function fmt(v) { return n(v).toLocaleString('en-US'); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms)) return '';
    if (ms < 90000) return 'just now';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 24 ? h + ' h ago' : Math.floor(h / 24) + ' d ago';
  }
  function chartName(c) { c = String(c || ''); return c.charAt(0).toUpperCase() + c.slice(1); }

  function render(data) {
    var totals = (data && data.totals) || {};
    var runs = (data && Array.isArray(data.runs)) ? data.runs : [];
    section.hidden = false;
    if (!n(totals.passes) || !runs.length) { empty.hidden = false; main.hidden = true; return; }
    empty.hidden = true; main.hidden = false;

    document.getElementById('rs-reviews').textContent = fmt(totals.reviewsRead);
    document.getElementById('rs-games').textContent = fmt(totals.gamesRead);

    var max = 1;
    KINDS.forEach(function (k) { max = Math.max(max, n(totals[k[0]])); });
    var bars = document.getElementById('rs-bars');
    bars.textContent = '';
    KINDS.forEach(function (k) {
      var li = el('li');
      li.style.setProperty('--c', k[2]);
      li.appendChild(el('span', null, k[1]));
      var bar = el('i');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--w', (n(totals[k[0]]) / max) * 100 + '%');
      li.appendChild(bar);
      li.appendChild(el('b', null, fmt(totals[k[0]])));
      bars.appendChild(li);
    });

    // The newest read of each chart (runs arrive newest first).
    var seen = {};
    var latest = runs.filter(function (r) {
      var key = String(r.chart || '');
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
    var list = document.getElementById('rs-charts');
    list.textContent = '';
    latest.forEach(function (r) {
      var li = el('li', 'rs-chart');
      var top = el('div', 'rs-chart-top');
      top.appendChild(el('h4', null, chartName(r.chart)));
      var t = el('time', null, 'Read ' + ago(r.at));
      t.setAttribute('datetime', r.at);
      t.title = new Date(r.at).toLocaleString();
      top.appendChild(t);
      li.appendChild(top);
      li.appendChild(el('p', 'rs-meta', fmt(r.reviewsRead) + ' reviews of ' + fmt(r.gamesRead) + ' games'));
      if (r.topReason) {
        var q = el('p', 'rs-reason');
        q.appendChild(el('small', null, 'Strongest example'));
        q.appendChild(document.createTextNode(r.topReason));
        li.appendChild(q);
      } else {
        li.appendChild(el('p', 'rs-none', 'No game on this chart showed a clear pattern yet.'));
      }
      list.appendChild(li);
    });
  }

  function load() {
    if (document.hidden) return;
    fetch('/market-research', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(render)
      .catch(function () { /* keep whatever is showing; the section stays hidden if it never loaded */ });
  }
  load();
  setInterval(load, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
