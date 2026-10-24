/* Greenwood Hub v1 — TizenBrew app module for UE55RU7172 (Tizen 5.0, Chromium M63).
 * ES2017 max: no optional chaining, no nullish coalescing, no ES modules.
 * Outbound: Open-Meteo weather (cached). Hub files themselves are served by TizenBrew via jsDelivr.
 * Remote keys (HDMI, Menu, Source, Home) go to service.js on 127.0.0.1:8095. No telemetry, no remote code.
 */
(function () {
  'use strict';

  var VERSION = '0.3.1';
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };
  /* TizenBrew serves the hub from http://127.0.0.1:8081/module/... The Tizen API is not injected
     into that page, so "on TV" = served by TizenBrew (or Tizen API present). */
  var HAS_TIZEN = typeof window.tizen !== 'undefined' && !!window.tizen.application;
  var SERVICE = 'http://127.0.0.1:8095'; /* service.js */
  var ON_TV = HAS_TIZEN || (location.hostname === '127.0.0.1' && location.port === '8081');

  var theme = null;
  var apps = {};
  var rows = [];          // [[{id, el, kind}], ...]
  var pos = { r: 0, c: 0 };
  var cardOpen = false;
  var drawerOpen = false;
  var menu = [];          // [{id, el}]
  var mpos = 0;
  var toastTimer = null;

  var ICONS = {
    hdmi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18v5l-3 3H6l-3-3z"/><path d="M8 11h8"/></svg>',
    iphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    samsung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    internet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function getJSON(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.onload = function () {
      if (x.status >= 200 && x.status < 300 || (x.status === 0 && x.responseText)) {
        try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); }
      } else { cb(new Error('HTTP ' + x.status)); }
    };
    x.onerror = function () { cb(new Error('network')); };
    x.send();
  }

  function store(k, v) {
    try {
      if (v === undefined) { return JSON.parse(window.localStorage.getItem('gw.' + k)); }
      window.localStorage.setItem('gw.' + k, JSON.stringify(v));
    } catch (e) { return null; }
    return null;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    var c = theme.colours || {};
    var root = document.documentElement.style;
    var map = { forest: '--forest', pine: '--pine', pineLight: '--pine-light', line: '--line', gold: '--gold', ivory: '--ivory', sage: '--sage' };
    Object.keys(map).forEach(function (k) { if (c[k]) { root.setProperty(map[k], c[k]); } });
    if (theme.background) { root.setProperty('--bg', theme.background); }
    $('name').textContent = theme.name || '';
    $('card-tv').textContent = theme.tvName || 'this TV';
  }

  /* ---------- Tiles ---------- */
  function makeTile(item, kind) {
    var el = document.createElement('div');
    var linked = kind === 'pill' || !!apps[item.id];
    if (kind === 'app') {
      el.className = 't app' + (linked ? '' : ' off');
      el.innerHTML = '<div class="l">' + esc(item.label) + '</div><div class="s">' + esc(linked ? (item.sub || '') : 'Not linked yet') + '</div>';
    } else if (kind === 'pill') {
      el.className = 't pill';
      el.innerHTML = (item.id === 'iphone' ? ICONS.iphone : ICONS.hdmi) + esc(item.label);
    } else {
      el.className = 't mi' + (linked ? '' : ' off');
      el.innerHTML = (ICONS[item.id] || '') + esc(item.label);
    }
    return { id: item.id, el: el, kind: kind };
  }

  function buildRows() {
    var defs = [
      { list: theme.watch || [], host: 'row-watch', kind: 'app' },
      { list: theme.connect || [], host: 'row-connect', kind: 'pill' }
    ];
    rows = [];
    defs.forEach(function (d) {
      var host = $(d.host);
      host.innerHTML = '';
      var row = d.list.map(function (item) {
        var t = makeTile(item, d.kind);
        host.appendChild(t.el);
        return t;
      });
      if (row.length) { rows.push(row); }
    });
    var mh = $('menu');
    mh.innerHTML = '';
    menu = (theme.menu || []).map(function (item) {
      var t = makeTile(item, 'menu');
      mh.appendChild(t.el);
      return t;
    });
  }

  /* ---------- Drawer ---------- */
  function setMenuFocus(i) {
    if (!menu.length) { return; }
    i = Math.max(0, Math.min(menu.length - 1, i));
    if (menu[mpos]) { menu[mpos].el.classList.remove('focus'); }
    mpos = i;
    menu[i].el.classList.add('focus');
  }
  function openDrawer() {
    if (!menu.length) { return; }
    drawerOpen = true; $('drawer').hidden = false;
    rows[pos.r][pos.c].el.classList.remove('focus'); /* one gold element at a time */
    setMenuFocus(0);
  }
  function closeDrawer() {
    drawerOpen = false; $('drawer').hidden = true;
    if (menu[mpos]) { menu[mpos].el.classList.remove('focus'); }
    setFocus(pos.r, pos.c);
  }

  function setFocus(r, c) {
    if (!rows.length) { return; }
    r = Math.max(0, Math.min(rows.length - 1, r));
    c = Math.max(0, Math.min(rows[r].length - 1, c));
    var old = rows[pos.r] && rows[pos.r][pos.c];
    if (old) { old.el.classList.remove('focus'); }
    pos = { r: r, c: c };
    rows[r][c].el.classList.add('focus');
    store('focus', pos);
  }

  /* Vertical move keeps the closest tile by screen position. */
  function moveVertical(dir) {
    var nr = pos.r + dir;
    if (nr < 0 || nr >= rows.length) { return; }
    var cur = rows[pos.r][pos.c].el.getBoundingClientRect();
    var mid = cur.left + cur.width / 2;
    var best = 0, bestD = Infinity;
    rows[nr].forEach(function (t, i) {
      var b = t.el.getBoundingClientRect();
      var d = Math.abs(b.left + b.width / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    setFocus(nr, best);
  }

  /* ---------- Actions ---------- */
  function launchApp(id, label) {
    var appId = apps[id];
    if (!appId) { toast(label + ': not linked yet'); return; }
    if (!ON_TV) { toast('Preview: would open ' + label); return; }
    if (HAS_TIZEN) {
      try {
        window.tizen.application.launch(appId,
          function () { countLaunch(id); },
          function (e) { toast(label + ' did not open (' + (e && e.name ? e.name : 'error') + ')'); });
      } catch (e) { toast(label + ' did not open'); }
      return;
    }
    /* No Tizen API in the page: service.js launches it (allowlisted app IDs only). */
    callService('/launch?id=' + encodeURIComponent(appId), function (r) {
      if (r.ok) { countLaunch(id); return; }
      toast(label + ' did not open' + (r.error ? ' (' + r.error + ')' : ''));
    });
  }

  /* GET to service.js on 127.0.0.1:8095; cb always gets an object {ok, error}. */
  function callService(path, cb, timeoutMs) {
    var x = new XMLHttpRequest();
    var answered = false;
    x.open('GET', SERVICE + path, true);
    x.timeout = timeoutMs || 8000;
    x.onload = function () {
      answered = true;
      var r = {};
      try { r = JSON.parse(x.responseText); } catch (e) { r = { ok: false, error: 'bad answer' }; }
      cb(r);
    };
    x.ontimeout = x.onerror = function () {
      if (!answered) { answered = true; cb({ ok: false, error: 'service' }); }
    };
    x.send();
  }

  function countLaunch(id) {
    var counts = store('launches') || {};
    counts[id] = (counts[id] || 0) + 1;
    store('launches', counts);
  }

  /* Remote keys (HDMI 1-3, Menu, Source, Home): sent by service.js, which talks to the TV's
     own remote API (wss://127.0.0.1:8002). This TV refuses the plain ws:// socket.
     First use shows an "Allow" prompt on the TV for "Greenwood Hub" (Ričards accepts once). */
  function sendKey(keyCode, label) {
    if (!ON_TV) { toast('Preview: ' + label + ' \u2192 remote key ' + keyCode); return; }
    callService('/key?k=' + encodeURIComponent(keyCode), function (r) {
      if (r.ok) { return; }
      if (r.error === 'denied') { toast('Not allowed. Accept "Greenwood Hub" on the TV prompt.'); }
      else if (r.error === 'timeout') { toast('No answer. Check for an "Allow" prompt on the TV.'); }
      else if (r.error === 'service') { toast('Hub service not running. Use the Source button.'); }
      else { toast(label + ': remote key failed. Use the Source button.'); }
    }, 35000); /* covers the one-time "Allow" prompt */
  }

  function labelOf(id) { var it = findItem(id); return it ? it.label : id; }

  /* KEY_* targets go to the remote socket, everything else is a native app ID. */
  function runTarget(id, label) {
    if (id === 'iphone') { openCard(); return; }
    var target = apps[id] || '';
    if (target.indexOf('KEY_') === 0) { sendKey(target, label); countLaunch(id); return; }
    launchApp(id, label);
  }

  function activate() {
    var t = rows[pos.r][pos.c];
    runTarget(t.id, labelOf(t.id));
  }

  function findItem(id) {
    var all = [].concat(theme.watch || [], theme.connect || [], theme.menu || []);
    for (var i = 0; i < all.length; i++) { if (all[i].id === id) { return all[i]; } }
    return null;
  }

  function openCard() { cardOpen = true; $('card').hidden = false; }
  function closeCard() { cardOpen = false; $('card').hidden = true; }

  /* ---------- Keys ---------- */
  function onKey(e) {
    var k = e.keyCode;
    if (cardOpen) {
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE || k === KEY.ENTER) { e.preventDefault(); closeCard(); }
      return;
    }
    if (drawerOpen) {
      e.preventDefault();
      if (k === KEY.UP) { setMenuFocus(mpos - 1); }
      else if (k === KEY.DOWN) { setMenuFocus(mpos + 1); }
      else if (k === KEY.RIGHT || k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closeDrawer(); }
      else if (k === KEY.ENTER) { runTarget(menu[mpos].id, labelOf(menu[mpos].id)); }
      return;
    }
    switch (k) {
      case KEY.LEFT: e.preventDefault(); if (pos.c === 0) { openDrawer(); } else { setFocus(pos.r, pos.c - 1); } break;
      case KEY.RIGHT: e.preventDefault(); setFocus(pos.r, pos.c + 1); break;
      case KEY.UP: e.preventDefault(); moveVertical(-1); break;
      case KEY.DOWN: e.preventDefault(); moveVertical(1); break;
      case KEY.ENTER: e.preventDefault(); activate(); break;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
        e.preventDefault(); /* Back on home does nothing: no accidental exit. */ break;
      default: break;
    }
  }

  /* ---------- Watch (CLK-4) ---------- */
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* shadow offsets in px, from img/watch/watch.json (render-watch.js) */
  var SHADOW = { hour: [2.6, 5.2], minute: [4.16, 7.8], second: [5.72, 10.4], small: [1.04, 2.08] };
  var hands = null;
  var lastDay = -1, lastHour = -1;

  function turn(el, deg, sh) {
    var t = (sh ? 'translate(' + sh[0] + 'px,' + sh[1] + 'px) ' : '') + 'rotate(' + deg.toFixed(2) + 'deg)';
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  function moonPath(frac) {
    var cx = 50, cy = 50, r = 32;
    var rx = Math.abs(Math.cos(2 * Math.PI * frac)) * r;
    var f = (1 - Math.cos(2 * Math.PI * frac)) / 2;
    if (f < 0.01) { return ''; }
    var top = cx + ' ' + (cy - r), bot = cx + ' ' + (cy + r);
    if (frac < 0.5) {
      return 'M' + top + ' A' + r + ' ' + r + ' 0 0 1 ' + bot + ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + (f < 0.5 ? 0 : 1) + ' ' + top + ' Z';
    }
    return 'M' + top + ' A' + r + ' ' + r + ' 0 0 0 ' + bot + ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + (f < 0.5 ? 1 : 0) + ' ' + top + ' Z';
  }

  function tick() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    var daySec = h * 3600 + m * 60 + s;
    var showSec = !(theme.clock && theme.clock.secondHand === false);
    turn(hands.hour, daySec / 120); turn(hands.hourS, daySec / 120, SHADOW.hour);
    turn(hands.min, daySec / 10); turn(hands.minS, daySec / 10, SHADOW.minute);
    if (showSec) { turn(hands.sec, s * 6); turn(hands.secS, s * 6, SHADOW.second); }
    if (d.getDate() !== lastDay) {
      lastDay = d.getDate();
      turn(hands.day, d.getDay() * 360 / 7); turn(hands.dayS, d.getDay() * 360 / 7, SHADOW.small);
      turn(hands.date, (d.getDate() - 1) * 360 / 31); turn(hands.dateS, (d.getDate() - 1) * 360 / 31, SHADOW.small);
      $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    }
    if (h !== lastHour) {
      lastHour = h;
      var age = (((d.getTime() / 86400000 - 10962.76) % 29.530588) + 29.530588) % 29.530588;
      $('moon-path').setAttribute('d', moonPath(age / 29.530588));
      $('greeting').textContent = (h < 5 ? 'Good Night' : h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening') + ',';
    }
    var wait = showSec ? 1000 - d.getMilliseconds() : (60 - s) * 1000 - d.getMilliseconds();
    setTimeout(tick, Math.max(200, wait));
  }

  function initWatch() {
    hands = { hour: $('h-hour'), hourS: $('h-hour-s'), min: $('h-min'), minS: $('h-min-s'), sec: $('h-sec'), secS: $('h-sec-s'),
      day: $('h-day'), dayS: $('h-day-s'), date: $('h-date'), dateS: $('h-date-s') };
    if (theme.clock && theme.clock.secondHand === false) { hands.sec.style.display = 'none'; hands.secS.style.display = 'none'; }
  }

  /* ---------- Weather (Open-Meteo, cached) ---------- */
  var WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };

  function showWeather(w, stale) {
    if (!w) { $('weather').textContent = (theme.weather.place || '') + ' · weather unavailable'; return; }
    $('weather').textContent = (theme.weather.place || '') + ' · ' + Math.round(w.t) + '°C · ' + (WMO[w.code] || '—') + (stale ? ' · offline' : '');
  }

  function weather() {
    var cfg = theme.weather || {};
    if (!cfg.enabled) { $('weather').textContent = ''; return; }
    var maxAge = (cfg.cacheMinutes || 30) * 60000;
    var cached = store('weather');
    if (cached && Date.now() - cached.at < maxAge) {
      showWeather(cached, false);
      setTimeout(weather, maxAge - (Date.now() - cached.at) + 1000);
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.latitude + '&longitude=' + cfg.longitude +
      '&current=temperature_2m,weather_code&timezone=auto';
    getJSON(url, function (err, data) {
      if (!err && data && data.current) {
        var w = { t: data.current.temperature_2m, code: data.current.weather_code, at: Date.now() };
        store('weather', w);
        showWeather(w, false);
      } else {
        showWeather(cached, true); /* last known value if offline */
      }
      setTimeout(weather, maxAge);
    });
  }

  /* ---------- PC preview scaling ---------- */
  function fit() {
    if (ON_TV) { return; }
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var st = $('stage');
    st.style.transform = 'scale(' + s + ')';
    document.body.style.width = document.documentElement.style.width = (1920 * s) + 'px';
    document.body.style.height = document.documentElement.style.height = (1080 * s) + 'px';
  }

  /* ---------- Start ---------- */
  function start() {
    applyTheme();
    buildRows();
    var saved = store('focus');
    setFocus(saved ? saved.r : 0, saved ? saved.c : 0);
    initWatch();
    tick();
    weather();
    document.addEventListener('keydown', onKey);
    $('edge').addEventListener('click', openDrawer);
    $('drawer').addEventListener('click', function (e) { if (e.target.className === 'drawer-dim') { closeDrawer(); } });
    if (!ON_TV) {
      $('badge').hidden = false;
      document.body.style.cursor = 'default';
      window.addEventListener('resize', fit);
      fit();
    }
  }

  function load() {
    var inline = window.GREENWOOD_INLINE; /* used only by the single-file preview build */
    if (inline) { theme = inline.theme; apps = inline.apps; start(); return; }
    getJSON('theme.json?v=' + VERSION, function (err, t) {
      if (err) { toast('theme.json could not be read'); return; }
      theme = t;
      getJSON('apps.json?v=' + VERSION, function (err2, a) {
        apps = err2 ? {} : a;
        start();
      });
    });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', load); } else { load(); }
})();
