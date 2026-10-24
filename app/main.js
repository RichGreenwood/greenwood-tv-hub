/* Greenwood Hub — TizenBrew app module for UE55RU7172 (Tizen 5.0, Chromium M63).
 * ES2017 max: no optional chaining, no nullish coalescing, no ES modules. Animate transform/opacity only.
 * Outbound: Open-Meteo weather; calendar links are read by service.js. Files come via jsDelivr (TizenBrew).
 * Apps, icons, keys, calendar, sleep timer and status go through service.js on 127.0.0.1:8095.
 * Texts: i18n.js (en, lv, fr). No telemetry, no ads, no remote code.
 */
(function () {
  'use strict';

  var VERSION = '0.5.0';
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };
  var HAS_TIZEN = typeof window.tizen !== 'undefined' && !!window.tizen.application;
  var SERVICE = 'http://127.0.0.1:8095';
  var ON_TV = HAS_TIZEN || (location.hostname === '127.0.0.1' && location.port === '8081');
  var T = window.GW_I18N || { en: {} };
  var WMO_T = window.GW_WMO || { en: {} };
  var LANGS = ['en', 'lv', 'fr'];
  var LANG_NAME = { en: 'English', lv: 'Latviešu', fr: 'Français' };

  var theme = null, apps = {}, prefs = {};
  var rows = [], pos = { r: 0, c: 0 };
  var menu = [], mpos = 0;     /* left drawer */
  var rmenu = [], rpos = 0;    /* right drawer (screens) */
  var mode = 'home';           /* home | drawer | rdrawer | card | all | scr | idle */
  var toastTimer = null, idleTimer = null;
  var nameDays = null;
  var calData = { configured: 0, events: [], at: 0 };
  var sleepEndsAt = 0;
  var forceNight = false;

  /* ---------- Language ---------- */
  function dict(lang) { return T[lang] || T.en; }
  function tl(lang, k) { var v = dict(lang)[k]; return v === undefined ? T.en[k] : v; }
  function t(k) { return tl(prefs.lang, k); }
  function hasSecond() { return prefs.lang2 && prefs.lang2 !== 'none' && prefs.lang2 !== prefs.lang; }
  function t2(k) { return hasSecond() ? tl(prefs.lang2, k) : ''; }
  function fmt(s, n) { return String(s).replace('{n}', n); }

  var ICONS = {
    hdmi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18v5l-3 3H6l-3-3z"/><path d="M8 11h8"/></svg>',
    iphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    samsung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    internet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>',
    idle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
    night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    weather: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/></svg>',
    daylight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20"/><path d="M5 18a7 7 0 0 1 14 0"/><circle cx="15.5" cy="11.5" r="1.8"/></svg>',
    look: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 3.5a8.5 8.5 0 0 1 0 17"/></svg>',
    sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>'
  };
  var WX = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/></svg>',
    partly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5a3.6 3.6 0 0 1 6.3 1.4"/><path d="M8.6 2.6v1.4M3.6 7.6H5M4.9 3.9l1 1"/><path d="M8 20h9a3.6 3.6 0 0 0 .5-7.17A5.3 5.3 0 0 0 7.3 11.5 3.8 3.8 0 0 0 8 20z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M7 13h10a3.5 3.5 0 0 0 .4-6.97A5.3 5.3 0 0 0 7.2 5.5 3.7 3.7 0 0 0 7 13z"/><path d="M4 16.5h16M6 19.5h12"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a3.6 3.6 0 0 0 .4-7.17A5.4 5.4 0 0 0 7.1 6.4 3.8 3.8 0 0 0 7 14z"/><path d="M8.5 17l-1 2.5M12.5 17l-1 2.5M16.5 17l-1 2.5"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a3.6 3.6 0 0 0 .4-7.17A5.4 5.4 0 0 0 7.1 6.4 3.8 3.8 0 0 0 7 14z"/><path d="M8.5 17.5h.01M12 19h.01M15.5 17.5h.01M10 21h.01M14 21h.01"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a3.6 3.6 0 0 0 .4-7.17A5.4 5.4 0 0 0 7.1 6.4 3.8 3.8 0 0 0 7 14z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/></svg>'
  };

  /* ---------- Utils ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dayStart(offset, from) { var n = from ? new Date(from) : new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + (offset || 0)).getTime(); }
  function durL(lang, ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    var h = Math.floor(m / 60), mm = m % 60;
    return (h ? h + ' ' + tl(lang, 'h') + ' ' : '') + pad2(mm) + ' ' + tl(lang, 'min');
  }
  function dur(ms) { return durL(prefs.lang, ms); }

  function getJSON(url, cb, timeoutMs) {
    var x = new XMLHttpRequest();
    var done = false;
    x.open('GET', url, true);
    if (timeoutMs) { x.timeout = timeoutMs; }
    x.onload = function () {
      if (done) { return; }
      done = true;
      if (x.status >= 200 && x.status < 300 || (x.status === 0 && x.responseText)) {
        try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); }
      } else { cb(new Error('HTTP ' + x.status)); }
    };
    x.onerror = x.ontimeout = function () { if (!done) { done = true; cb(new Error('network')); } };
    x.send();
  }
  function callService(path, cb, timeoutMs) {
    getJSON(SERVICE + path, function (err, r) {
      cb(err ? { ok: false, error: 'service' } : (r || { ok: false, error: 'bad answer' }));
    }, timeoutMs || 8000);
  }
  function store(k, v) {
    try {
      if (v === undefined) { return JSON.parse(window.localStorage.getItem('gw.' + k)); }
      window.localStorage.setItem('gw.' + k, JSON.stringify(v));
    } catch (e) { return null; }
    return null;
  }
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  /* ---------- Preferences (per TV; defaults from theme.json) ---------- */
  function loadPrefs() {
    var saved = store('prefs') || {};
    var night = theme.night || {};
    var lang = LANGS.indexOf(saved.lang) >= 0 ? saved.lang : (LANGS.indexOf(theme.language) >= 0 ? theme.language : 'en');
    var lang2 = saved.lang2 !== undefined ? saved.lang2 : (theme.language2 || 'none');
    if (lang2 !== 'none' && (LANGS.indexOf(lang2) < 0 || lang2 === lang)) { lang2 = 'none'; }
    prefs = {
      lang: lang, lang2: lang2,
      face: ['gold', 'silver', 'digital'].indexOf(saved.face) >= 0 ? saved.face : (theme.watchFace || 'gold'),
      guest: saved.guest === true,
      night: saved.night !== undefined ? !!saved.night : (night.enabled !== false)
    };
  }
  function savePrefs() { store('prefs', prefs); }

  function formatDateL(lang, d) {
    var dl = dict(lang);
    if (lang === 'lv') { return dl.days[d.getDay()] + ', ' + d.getDate() + '. ' + dl.months[d.getMonth()]; }
    if (lang === 'fr') { return dl.days[d.getDay()] + ' ' + (d.getDate() === 1 ? '1er' : d.getDate()) + ' ' + dl.months[d.getMonth()]; }
    return dl.days[d.getDay()] + ', ' + d.getDate() + ' ' + dl.months[d.getMonth()];
  }
  function greetIndex(h) { return h < 5 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3; }
  function nameFor(lang) {
    if (prefs.guest) { return ''; }
    return lang === 'lv' ? (theme.nameLv || theme.name || '') : (theme.name || '');
  }
  function wmoL(lang, code) { var m = WMO_T[lang] || WMO_T.en; return m[code] || '—'; }
  function wmo(code) { return wmoL(prefs.lang, code); }

  /* ---------- Static texts, theme ---------- */
  function applyTexts() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (nodes[i].getAttribute('data-bi') && hasSecond() && t2(k) !== t(k)) {
        nodes[i].innerHTML = esc(t(k)) + '<span class="sec-inline">' + esc(t2(k)) + '</span>';
      } else { nodes[i].textContent = t(k); }
    }
    var hn = document.querySelectorAll('[data-i18n-html]');
    for (var j = 0; j < hn.length; j++) { hn[j].innerHTML = t(hn[j].getAttribute('data-i18n-html')); }
    document.documentElement.lang = prefs.lang;
    $('all-more').setAttribute('data-more', t('moreApps'));
  }
  function applyTheme() {
    var c = theme.colours || {};
    var root = document.documentElement.style;
    var map = { forest: '--forest', pine: '--pine', pineLight: '--pine-light', line: '--line', gold: '--gold', ivory: '--ivory', sage: '--sage' };
    Object.keys(map).forEach(function (k) { if (c[k]) { root.setProperty(map[k], c[k]); } });
    if (theme.background) { root.setProperty('--bg', theme.background); }
    $('card-tv').textContent = theme.tvName || 'this TV';
  }
  function applyFace() {
    $('watch').className = 'watch face-' + (prefs.face || 'gold');
    var dir = prefs.face === 'silver' ? 'img/silver/' : 'img/';
    var imgs = $('watch').querySelectorAll('img[data-n]');
    for (var i = 0; i < imgs.length; i++) {
      var src = dir + imgs[i].getAttribute('data-n') + '.png';
      if (imgs[i].getAttribute('src') !== src) { imgs[i].setAttribute('src', src); }
    }
    document.querySelector('.greet').setAttribute('data-guest', t('guestOn'));
    setStageClass();
  }
  function setStageClass() {
    var c = 'stage';
    if (mode === 'idle') { c += ' idle' + ((forceNight || isNight()) ? ' night' : ''); }
    if (prefs.guest) { c += ' guest'; }
    if (hasSecond()) { c += ' bilingual'; }
    $('stage').className = c;
  }
  function refreshAll() {
    applyTexts();
    applyFace();
    lastDay = -1; lastHour = -1; lastMin = -1;
    tick();
    buildRows();
    if (mode === 'home' && rows.length) { setFocus(pos.r, pos.c); }
    showNameDays();
    renderAgenda();
    renderWeek();
    updateSleepBadge();
    showWeather(store('weather'), false);
    renderSun();
  }

  /* ---------- Home tiles ---------- */
  function iconFor(id) { return id.indexOf('hdmi') === 0 ? ICONS.hdmi : (ICONS[id] || ''); }
  var SPECIAL = { iphone: 1, apps: 1, idle: 1, night: 1, calendar: 1, weather: 1, daylight: 1, look: 1, sleep: 1, about: 1 };
  function isLinked(id) { return !!SPECIAL[id] || !!apps[id]; }
  function labelL(lang, item, kind) {
    var d = dict(lang);
    if ((kind === 'menu' || kind === 'screen') && d['m_' + item.id]) { return d['m_' + item.id]; }
    if (kind === 'pill' && d['c_' + item.id]) { return d['c_' + item.id]; }
    return item.label || item.id;
  }
  function subL(lang, item) { var d = dict(lang); return lang !== 'en' && d['s_' + item.id] ? d['s_' + item.id] : (item.sub || ''); }

  function makeTile(item, kind) {
    var el = document.createElement('div');
    var linked = isLinked(item.id);
    var label = labelL(prefs.lang, item, kind);
    var label2 = hasSecond() ? labelL(prefs.lang2, item, kind) : '';
    if (label2 === label) { label2 = ''; }
    if (kind === 'app') {
      el.className = 't app' + (linked ? '' : ' off');
      var sub = linked ? subL(prefs.lang, item) : 'Not linked yet';
      var sub2 = hasSecond() && linked ? subL(prefs.lang2, item) : '';
      el.innerHTML = '<div class="l">' + esc(label) + '</div><div class="s">' + esc(sub) + '</div>' + (sub2 && sub2 !== sub ? '<div class="s2">' + esc(sub2) + '</div>' : '');
    } else if (kind === 'pill') {
      el.className = 't pill' + (label2 ? ' pill-bi' : '');
      el.innerHTML = iconFor(item.id) + '<span class="pl">' + esc(label) + (label2 ? '<span class="pl2">' + esc(label2) + '</span>' : '') + '</span>';
    } else if (kind === 'screen') {
      el.className = 't rmi';
      el.innerHTML = '<span class="rmi-ic">' + iconFor(item.id) + '</span><span class="rmi-tx"><span class="rmi-l">' + esc(label) +
        (label2 ? '<span class="sec-inline">' + esc(label2) + '</span>' : '') + '</span><span class="rmi-d">' + esc(t('d_' + item.id) || '') + '</span></span>';
    } else {
      var small = item.group === 'samsung';
      el.className = 't mi' + (linked ? '' : ' off') + (small ? ' mi-small' : '');
      el.innerHTML = iconFor(item.id) + '<span class="mi-l">' + esc(label) + (label2 ? '<span class="mi2">' + esc(label2) + '</span>' : '') + '</span>';
    }
    return { id: item.id, el: el, kind: kind, label: label };
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
      var row = d.list.map(function (item) { var tile = makeTile(item, d.kind); host.appendChild(tile.el); return tile; });
      if (row.length) { rows.push(row); }
    });
    var mh = $('menu');
    mh.innerHTML = '';
    var lastGroup = '';
    menu = (theme.menu || []).map(function (item) {
      if (lastGroup && item.group !== lastGroup) { var sep = document.createElement('div'); sep.className = 'mi-sep'; mh.appendChild(sep); }
      lastGroup = item.group || 'hub';
      var tile = makeTile(item, 'menu');
      mh.appendChild(tile.el);
      return tile;
    });
    var rh = $('rmenu');
    rh.innerHTML = '';
    rmenu = (theme.screens || []).map(function (item) {
      var tile = makeTile(item, 'screen');
      rh.appendChild(tile.el);
      return tile;
    });
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
  function nearestIn(list, fromEl) {
    var cur = fromEl.getBoundingClientRect();
    var mid = cur.left + cur.width / 2;
    var best = 0, bestD = Infinity;
    list.forEach(function (tile, i) {
      var b = tile.el.getBoundingClientRect();
      var d = Math.abs(b.left + b.width / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function moveVertical(dir) {
    var nr = pos.r + dir;
    if (nr < 0 || nr >= rows.length) { return; }
    setFocus(nr, nearestIn(rows[nr], rows[pos.r][pos.c].el));
  }
  function blurHome() { if (rows[pos.r] && rows[pos.r][pos.c]) { rows[pos.r][pos.c].el.classList.remove('focus'); } }

  /* ---------- Drawers (left: settings, right: screens) ---------- */
  function setListFocus(list, cur, i) {
    if (!list.length) { return cur; }
    i = Math.max(0, Math.min(list.length - 1, i));
    if (list[cur]) { list[cur].el.classList.remove('focus'); }
    list[i].el.classList.add('focus');
    return i;
  }
  function openDrawer() { if (!menu.length) { return; } mode = 'drawer'; $('drawer').hidden = false; blurHome(); mpos = setListFocus(menu, mpos, 0); }
  function closeDrawer() { mode = 'home'; $('drawer').hidden = true; if (menu[mpos]) { menu[mpos].el.classList.remove('focus'); } setFocus(pos.r, pos.c); }
  function openRDrawer() { if (!rmenu.length) { return; } mode = 'rdrawer'; $('rdrawer').hidden = false; blurHome(); rpos = setListFocus(rmenu, rpos, 0); }
  function closeRDrawer() { mode = 'home'; $('rdrawer').hidden = true; if (rmenu[rpos]) { rmenu[rpos].el.classList.remove('focus'); } setFocus(pos.r, pos.c); }
  function hideDrawers() {
    $('drawer').hidden = true; $('rdrawer').hidden = true;
    if (menu[mpos]) { menu[mpos].el.classList.remove('focus'); }
    if (rmenu[rpos]) { rmenu[rpos].el.classList.remove('focus'); }
  }

  function openCard() { mode = 'card'; $('card').hidden = false; }
  function closeCard() { mode = 'home'; $('card').hidden = true; setFocus(pos.r, pos.c); }

  /* ---------- Launch counts ---------- */
  function countLaunch(key) {
    var counts = store('launches') || {};
    counts[key] = (counts[key] || 0) + 1;
    store('launches', counts);
  }

  /* ---------- Actions ---------- */
  function launchAppId(appId, label, countKey) {
    if (!appId) { toast(label + ': not linked yet'); return; }
    if (!ON_TV) { toast('Preview: would open ' + label); return; }
    if (HAS_TIZEN) {
      try {
        window.tizen.application.launch(appId, function () { countLaunch(countKey); },
          function (e) { toast(label + ' did not open (' + (e && e.name ? e.name : 'error') + ')'); });
      } catch (e) { toast(label + ' did not open'); }
      return;
    }
    callService('/launch?id=' + encodeURIComponent(appId), function (r) {
      if (r.ok) { countLaunch(countKey); return; }
      if (r.error === 'service') { toast(label + ': hub helper not running. Restart the TV once.'); return; }
      toast(label + ' did not open (' + (r.error || 'error') + ')');
    });
  }

  var KEY_HINT = { KEY_MENU: 'the ⚙ button', KEY_SOURCE: 'the Source button', KEY_HOME: 'the Home button' };
  function sendKey(keyCode, label) {
    if (!ON_TV) { toast('Preview: ' + label + ' → remote key ' + keyCode); return; }
    callService('/key?k=' + encodeURIComponent(keyCode), function (r) {
      if (r.ok) { return; }
      var hint = KEY_HINT[keyCode] ? ' Use ' + KEY_HINT[keyCode] + ' on the remote.' : ' Use the Source button on the remote.';
      if (r.error === 'denied') { toast('Not allowed: accept "Greenwood Hub" on the TV prompt.'); }
      else if (r.error === 'timeout') { toast('No answer: check for an "Allow" prompt on the TV.'); }
      else if (r.error === 'service') { toast(label + ': hub helper not running.' + hint); }
      else { toast(label + ' failed (' + (r.error || '?') + (r.detail ? ' / ' + r.detail : '') + ').' + hint); }
    }, 70000);
  }

  function labelOf(id) {
    var all = [].concat(rows[0] || [], rows[1] || [], menu, rmenu);
    for (var i = 0; i < all.length; i++) { if (all[i].id === id) { return all[i].label; } }
    return id;
  }

  function runTarget(id) {
    var label = labelOf(id);
    if (id === 'iphone') { hideDrawers(); openCard(); return; }
    if (id === 'apps') { openAll(); return; }
    if (id === 'idle') { forceNight = false; enterIdle(); return; }
    if (id === 'night') { forceNight = true; enterIdle(); return; }
    if (SCREENS[id]) { openScreen(id); return; }
    var target = apps[id] || '';
    if (target.indexOf('KEY_') === 0) { sendKey(target, label); return; }
    launchAppId(target, label, 'app:' + target);
  }

  /* ---------- All apps ---------- */
  var COLS = 6;
  var allList = [], allTiles = [], apos = 0, allScroll = 0;

  function staticApps() { return (apps._all || []).map(function (a) { return { id: a.id, name: a.name, icon: false }; }); }
  function cleanName(n) { return String(n).replace(/\s+[-–—:]\s+.*$/, '').trim() || String(n); }
  function sortApps(list) {
    var counts = store('launches') || {};
    list = list.map(function (a) { return { id: a.id, name: cleanName(a.name), icon: !!a.icon }; });
    return list.slice().sort(function (a, b) {
      var ca = counts['app:' + a.id] || 0, cb = counts['app:' + b.id] || 0;
      if (ca !== cb) { return cb - ca; }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  function monogram(name) {
    var words = String(name).replace(/[^A-Za-z0-9À-ɏ+ ]/g, ' ').split(/\s+/).filter(Boolean);
    var m = words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : String(name).slice(0, 2);
    return m.toUpperCase();
  }
  function renderAll() {
    var grid = $('all-grid');
    grid.innerHTML = '';
    allTiles = allList.map(function (a) {
      var el = document.createElement('div');
      el.className = 't at';
      el.innerHTML = '<div class="at-ic"><div class="at-mono">' + esc(monogram(a.name)) + '</div></div><div class="at-l">' + esc(a.name) + '</div>';
      if (a.icon && ON_TV) {
        var img = new Image();
        img.className = 'at-img';
        img.alt = '';
        img.onload = function () { var box = el.querySelector('.at-ic'); box.innerHTML = ''; box.appendChild(img); box.className = 'at-ic has-img'; };
        img.src = SERVICE + '/icon?id=' + encodeURIComponent(a.id);
      }
      grid.appendChild(el);
      return { id: a.id, name: a.name, el: el };
    });
    $('all-count').textContent = allList.length + ' ' + (allList.length === 1 ? t('app') : t('appsN'));
    $('all-empty').hidden = allList.length > 0;
  }
  function setAllFocus(i) {
    if (!allTiles.length) { return; }
    i = Math.max(0, Math.min(allTiles.length - 1, i));
    if (allTiles[apos]) { allTiles[apos].el.classList.remove('focus'); }
    apos = i;
    allTiles[i].el.classList.add('focus');
    var row = Math.floor(i / COLS), visible = 4;
    if (row < allScroll) { allScroll = row; }
    if (row > allScroll + visible - 1) { allScroll = row - visible + 1; }
    var y = -allScroll * 176;
    $('all-grid').style.transform = 'translateY(' + y + 'px)';
    $('all-grid').style.webkitTransform = 'translateY(' + y + 'px)';
    $('all-more').className = 'all-more' + (Math.ceil(allTiles.length / COLS) > allScroll + visible ? ' on' : '');
  }
  function loadAllApps(cb) {
    if (!ON_TV) { cb(staticApps()); return; }
    callService('/apps', function (r) { cb(r.ok && r.apps && r.apps.length ? r.apps : staticApps()); }, 6000);
  }
  function openAll() {
    hideDrawers();
    mode = 'all';
    blurHome();
    $('all').hidden = false;
    allScroll = 0;
    var cached = store('allApps');
    allList = sortApps(cached && cached.length ? cached : staticApps());
    renderAll();
    setAllFocus(0);
    loadAllApps(function (list) {
      store('allApps', list);
      if (mode !== 'all') { return; }
      var focusedId = allTiles[apos] ? allTiles[apos].id : null;
      allList = sortApps(list);
      renderAll();
      var idx = 0;
      for (var i = 0; i < allTiles.length; i++) { if (allTiles[i].id === focusedId) { idx = i; } }
      setAllFocus(idx);
    });
  }
  function closeAll() { mode = 'home'; $('all').hidden = true; setFocus(pos.r, pos.c); }
  function allKey(k) {
    var n = allTiles.length;
    if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closeAll(); return; }
    if (!n) { return; }
    if (k === KEY.LEFT) { if (apos % COLS > 0) { setAllFocus(apos - 1); } }
    else if (k === KEY.RIGHT) { if (apos % COLS < COLS - 1 && apos + 1 < n) { setAllFocus(apos + 1); } }
    else if (k === KEY.UP) { if (apos - COLS >= 0) { setAllFocus(apos - COLS); } }
    else if (k === KEY.DOWN) {
      if (apos + COLS < n) { setAllFocus(apos + COLS); }
      else if (Math.floor(apos / COLS) < Math.floor((n - 1) / COLS)) { setAllFocus(n - 1); }
    }
    else if (k === KEY.ENTER) { var tile = allTiles[apos]; launchAppId(tile.id, tile.name, 'app:' + tile.id); }
  }

  /* ---------- Screens (focusable .fx elements, spatial navigation) ---------- */
  var scr = { id: '', fx: [], f: -1, onBack: null, timer: null };

  function openScreen(id) {
    hideDrawers();
    blurHome();
    mode = 'scr';
    $('scr').hidden = false;
    renderScreen(id, 0);
  }
  function renderScreen(id, focusIndex) {
    clearInterval(scr.timer);
    scr.id = id;
    scr.onBack = null;
    var s = SCREENS[id];
    var title = s.title(prefs.lang), title2 = hasSecond() ? s.title(prefs.lang2) : '';
    $('scr-title').innerHTML = esc(title) + (title2 && title2 !== title ? '<span class="sec-inline">' + esc(title2) + '</span>' : '');
    $('scr-body').innerHTML = s.html();
    $('scr-body').className = 'scr-body scr-' + id;
    scr.fx = Array.prototype.slice.call($('scr-body').querySelectorAll('.fx'));
    scr.f = -1;
    var start = typeof focusIndex === 'number' ? focusIndex : 0;
    if (scr.fx.length) { setScrFocus(Math.min(start, scr.fx.length - 1)); }
    if (s.init) { s.init(); }
  }
  function setScrFocus(i) {
    if (scr.fx[scr.f]) { scr.fx[scr.f].classList.remove('focus'); }
    scr.f = i;
    if (scr.fx[i]) { scr.fx[i].classList.add('focus'); }
  }
  function closeScreen() {
    clearInterval(scr.timer);
    if (scr.onBack) { scr.onBack(); }
    $('scr').hidden = true;
    mode = 'home';
    setFocus(pos.r, pos.c);
    armIdle();
  }
  function scrMove(dx, dy) {
    var cur = scr.fx[scr.f];
    if (!cur) { return; }
    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var colMode = cur.classList.contains('cal-ev');
    var best = -1, bestScore = Infinity;
    scr.fx.forEach(function (el, i) {
      if (i === scr.f) { return; }
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var ddx = bx - ax, ddy = by - ay;
      if (dx) {
        if (ddx * dx <= 10) { return; }
        /* rows (look screen) stay on the same row; calendar columns may jump to any card in the next column */
        if (!colMode && Math.abs(ddy) > Math.max(a.height, b.height) * 0.6) { return; }
      }
      if (dy && ddy * dy <= 10) { return; }
      var main = dx ? Math.abs(ddx) : Math.abs(ddy);
      var cross = dx ? Math.abs(ddy) : Math.abs(ddx);
      var score = main + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) { setScrFocus(best); }
  }
  function scrKey(k) {
    if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closeScreen(); return; }
    if (k === KEY.LEFT) { scrMove(-1, 0); }
    else if (k === KEY.RIGHT) { scrMove(1, 0); }
    else if (k === KEY.UP) { scrMove(0, -1); }
    else if (k === KEY.DOWN) { scrMove(0, 1); }
    else if (k === KEY.ENTER) {
      var el = scr.fx[scr.f];
      var s = SCREENS[scr.id];
      if (el && s.act) { s.act(el.getAttribute('data-act') || '', el.getAttribute('data-v') || ''); }
    }
  }

  function evTitle(e) { return prefs.guest ? t('busy') : e.title; }
  function calDot(e) { return '<i class="cal-dot cal-' + (e.cal % 3) + '"></i>'; }
  function agoText(ms) { return ms ? fmt(t('agoFmt'), Math.max(0, Math.round((Date.now() - ms) / 60000))) : t('never'); }
  function mb(bytes) { return Math.round(bytes / (1024 * 1024)) + ' MB'; }
  function eventsOnDay(dayMs) {
    var end = dayStart(1, dayMs);
    return calData.events.filter(function (e) { return e.start < end && e.end > dayMs; });
  }

  var SCREENS = {
    calendar: {
      title: function (lang) { return tl(lang, 'calTitle'); },
      html: function () {
        if (!calData.configured) {
          return '<div class="scr-empty"><div class="scr-big">' + esc(t('calNotSet')) + '</div><div class="scr-note">' + esc(t('calHow')) + '</div>' +
            '<div class="btn fx" data-act="setup">' + esc(t('calConnect')) + '</div></div>';
        }
        var days = [];
        for (var i = 0; i < 7; i++) {
          var ds = dayStart(i);
          var evs = eventsOnDay(ds);
          if (evs.length) { days.push({ ms: ds, i: i, evs: evs }); }
        }
        if (!days.length) { return '<div class="scr-empty"><div class="scr-big">' + esc(t('calEmptyWeek')) + '</div></div>'; }
        var colW = Math.min(420, Math.floor((1728 - (days.length - 1) * 24) / days.length));
        var maxCards = 5;
        var sub2 = t2('calWeek');
        return '<div class="cw-sub">' + esc(t('calWeek')) + (sub2 && sub2 !== t('calWeek') ? ' · ' + esc(sub2) : '') + '</div><div class="cw">' + days.map(function (d) {
          var dt = new Date(d.ms);
          var head = d.i === 0 ? t('todayT') : d.i === 1 ? t('tomorrowT') : t('days')[dt.getDay()];
          var shown = d.evs.slice(0, maxCards);
          var more = d.evs.length - shown.length;
          return '<div class="cw-col' + (d.i === 0 ? ' today' : '') + '" style="width:' + colW + 'px">' +
            '<div class="cw-h"><span class="cw-dn">' + esc(head) + '</span><span class="cw-dd">' + dt.getDate() + '</span></div>' +
            shown.map(function (e) {
              var past = !e.allDay && e.end < Date.now();
              var time = e.allDay ? t('allDay') : hhmm(e.start) + '–' + hhmm(e.end);
              return '<div class="cal-ev fx' + (past ? ' past' : '') + '">' +
                '<div class="ce-t">' + calDot(e) + '<span class="ce-tm">' + esc(time) + '</span><span class="ce-l">' + esc(e.label || '') + '</span></div><div class="ce-n">' + esc(evTitle(e)) + '</div></div>';
            }).join('') + (more > 0 ? '<div class="cw-more">' + esc(fmt(t('moreN'), more)) + '</div>' : '') + '</div>';
        }).join('') + '</div>';
      },
      init: function () {
        var evs = $('scr-body').querySelectorAll('.cal-ev');
        for (var i = 0; i < evs.length; i++) { if (!evs[i].classList.contains('past')) { setScrFocus(scr.fx.indexOf(evs[i])); break; } }
      },
      act: function (a) { if (a === 'setup') { renderScreen('setup'); } }
    },
    weather: {
      title: function (lang) { return tl(lang, 'wxTitle'); },
      html: function () {
        var w = store('weather');
        var d = w && w.daily ? w.daily : null;
        var place = (theme.weather && theme.weather.place) || '';
        if (!d) { return '<div class="scr-empty"><div class="scr-big">' + esc(place + ' · ' + t('wxNA')) + '</div></div>'; }
        var html = '<div class="wx-place">' + esc(place) + ', ' + esc(t('wxNext')) + '</div><div class="wx-days">';
        for (var i = 0; i < Math.min(3, d.time.length); i++) {
          var dt = new Date(d.time[i] + 'T12:00:00');
          var name = i === 0 ? t('todayT') : t('days')[dt.getDay()];
          var c2 = hasSecond() ? wmoL(prefs.lang2, d.code[i]) : '';
          html += '<div class="wx-day fx"><div class="wx-dn">' + esc(name) + '</div><div class="wx-ic">' + wxIcon(d.code[i], 1) + '</div>' +
            '<div class="wx-t">' + Math.round(d.max[i]) + '°<span> / ' + Math.round(d.min[i]) + '°</span></div><div class="wx-c">' + esc(wmo(d.code[i])) + '</div>' +
            (c2 ? '<div class="wx-c2">' + esc(c2) + '</div>' : '') + '</div>';
        }
        html += '</div>';
        if (d.sunrise && d.sunrise[0]) {
          html += '<div class="wx-sun">' + esc(t('sunrise')) + ' <b>' + d.sunrise[0].slice(11, 16) + '</b> · ' + esc(t('sunset')) + ' <b>' + d.sunset[0].slice(11, 16) + '</b></div>';
        }
        return html;
      }
    },
    daylight: {
      title: function (lang) { return tl(lang, 'dlTitle'); },
      html: function () {
        return '<div class="dl"><svg class="dl-svg" id="dl-svg" viewBox="0 0 1500 520" width="1500" height="520"></svg><div class="dl-cap" id="dl-cap"></div><div class="dl-cap2" id="dl-cap2"></div></div>';
      },
      init: function () {
        drawSun($('dl-svg'), $('dl-cap'), $('dl-cap2'), 1500, 520, true);
        scr.timer = setInterval(function () { drawSun($('dl-svg'), $('dl-cap'), $('dl-cap2'), 1500, 520, true); }, 60000);
      }
    },
    look: {
      title: function (lang) { return tl(lang, 'lookTitle'); },
      html: function () {
        function opt(act, v, label, sel) { return '<div class="opt fx' + (sel ? ' sel' : '') + '" data-act="' + act + '" data-v="' + v + '">' + esc(label) + '</div>'; }
        function key(k, hint) {
          var k2 = t2(k);
          return '<div class="look-k">' + esc(t(k)) + (k2 && k2 !== t(k) ? '<span class="sec-inline">' + esc(k2) + '</span>' : '') + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
        }
        var l2 = '<div class="look-v">' + opt('lang2', 'none', t('noneLang'), !hasSecond()) +
          LANGS.filter(function (l) { return l !== prefs.lang; }).map(function (l) { return opt('lang2', l, LANG_NAME[l], prefs.lang2 === l); }).join('') + '</div>';
        return '<div class="look">' +
          '<div class="look-row">' + key('face') + '<div class="look-v">' +
            opt('face', 'gold', t('f_gold'), prefs.face === 'gold') + opt('face', 'silver', t('f_silver'), prefs.face === 'silver') + opt('face', 'digital', t('f_digital'), prefs.face === 'digital') + '</div></div>' +
          '<div class="look-row">' + key('language') + '<div class="look-v">' +
            LANGS.map(function (l) { return opt('lang', l, LANG_NAME[l], prefs.lang === l); }).join('') + '</div></div>' +
          '<div class="look-row">' + key('language2', t('language2Hint')) + l2 + '</div>' +
          '<div class="look-row">' + key('guest', t('guestHint')) + '<div class="look-v">' +
            opt('guest', '0', t('off'), !prefs.guest) + opt('guest', '1', t('on'), prefs.guest) + '</div></div>' +
          '<div class="look-row">' + key('night', nightLabel()) + '<div class="look-v">' +
            opt('night', '1', t('nightAuto'), prefs.night) + opt('night', '0', t('off'), !prefs.night) + '</div></div>' +
          '</div>';
      },
      act: function (a, v) {
        if (a === 'face') { prefs.face = v; }
        else if (a === 'lang') { prefs.lang = v; if (prefs.lang2 === v) { prefs.lang2 = 'none'; } }
        else if (a === 'lang2') { prefs.lang2 = v; }
        else if (a === 'guest') { prefs.guest = v === '1'; }
        else if (a === 'night') { prefs.night = v === '1'; }
        savePrefs();
        var keep = scr.f;
        refreshAll();
        renderScreen('look', keep);
      }
    },
    sleep: {
      title: function (lang) { return tl(lang, 'sleepTitle'); },
      html: function () {
        var opts = [15, 30, 60, 90, 120];
        var left = sleepEndsAt > Date.now() ? Math.ceil((sleepEndsAt - Date.now()) / 60000) : 0;
        return '<div class="sl"><div class="scr-big">' + esc(t('sleepQ')) + '</div><div class="scr-note">' + esc(t('sleepNote')) + '</div><div class="sl-opts">' +
          opts.map(function (m) { return '<div class="pillopt fx" data-act="set" data-v="' + m + '">' + m + ' ' + esc(t('min')) + '</div>'; }).join('') +
          '<div class="pillopt fx" data-act="set" data-v="0">' + esc(t('sleepOff')) + '</div></div>' +
          (left ? '<div class="sl-left">' + esc(t('sleepSet')) + ' ' + left + ' ' + esc(t('min')) + '</div>' : '') + '</div>';
      },
      act: function (a, v) {
        var m = +v;
        if (!ON_TV) { sleepEndsAt = m ? Date.now() + m * 60000 : 0; updateSleepBadge(); toast(m ? t('sleepSet') + ' ' + m + ' ' + t('min') : t('sleepCancelled')); closeScreen(); return; }
        callService('/sleep?min=' + m, function (r) {
          if (!r.ok) { toast('Sleep timer: hub helper not running'); return; }
          sleepEndsAt = r.endsAt || 0;
          updateSleepBadge();
          toast(m ? t('sleepSet') + ' ' + m + ' ' + t('min') : t('sleepCancelled'));
          closeScreen();
        });
      }
    },
    about: {
      title: function (lang) { return tl(lang, 'aboutTitle'); },
      html: function () {
        return '<div class="ab"><div class="ab-rows" id="ab-rows"></div><div class="ab-btns">' +
          '<div class="btn fx" data-act="setup">' + esc(t('calConnect')) + '</div>' +
          '<div class="btn fx" data-act="refresh">' + esc(t('calRefresh')) + '</div>' +
          (calData.configured ? '<div class="btn fx" data-act="forget">' + esc(t('calForget')) + '</div>' : '') + '</div></div>';
      },
      init: function () {
        function row(k, v, st) { return '<div class="ab-row"><i class="st st-' + st + '"></i><span class="ab-k">' + esc(k) + '</span><span class="ab-v">' + esc(v) + '</span></div>'; }
        function paint(s) {
          var w = store('weather');
          var html = row(t('a_version'), VERSION + (s && s.version && s.version !== VERSION ? ' (helper ' + s.version + ')' : ''), 'ok');
          html += row(t('a_helper'), s ? t('running') + ' · ' + s.uptimeMin + ' ' + t('min') : t('notRunning'), s ? 'ok' : 'bad');
          html += row(t('a_keys'), s && s.token ? t('allowed') : t('notYet'), s && s.token ? 'ok' : 'warn');
          html += row(t('a_weather'), w ? agoText(w.at) : t('never'), w ? 'ok' : 'warn');
          var cals = s ? s.calendars || [] : [];
          var calErr = s && s.calendarErrors && s.calendarErrors.length;
          html += row(t('a_calendar'), cals.length ? cals.join(' + ') + ' · ' + agoText(s.calendarAt) + (calErr ? ' · ' + s.calendarErrors[0].error : '') : t('never'), cals.length ? (calErr ? 'warn' : 'ok') : 'warn');
          html += row(t('a_storage'), s && s.storage ? mb(s.storage.free) + ' / ' + mb(s.storage.total) : '—', s && s.storage && s.storage.free < 100 * 1024 * 1024 ? 'warn' : 'ok');
          html += row(t('a_network'), s && s.ip ? s.ip : '—', s && s.ip ? 'ok' : 'warn');
          $('ab-rows').innerHTML = html;
        }
        paint(null);
        if (ON_TV) { callService('/status', function (r) { if (scr.id === 'about') { paint(r.ok ? r : null); } }, 4000); }
      },
      act: function (a) {
        if (a === 'setup') { renderScreen('setup'); }
        else if (a === 'refresh') { loadCalendar(true, function () { toast(t('calRefresh') + ' ✓'); if (scr.id === 'about') { renderScreen('about', scr.f); } }); }
        else if (a === 'forget') { callService('/setup/forget', function () { calData = { configured: 0, events: [], at: 0 }; store('cal', calData); renderAgenda(); renderWeek(); renderScreen('about', 0); }); }
      }
    },
    setup: {
      title: function (lang) { return tl(lang, 'setupTitle'); },
      html: function () {
        return '<div class="su"><div class="su-k">' + esc(t('setupCode')) + '</div><div class="su-code" id="su-code">••• •••</div>' +
          '<div class="scr-note">' + esc(t('setupSay')) + '</div><div class="su-state" id="su-state">' + esc(t('setupWait')) + '</div>' +
          '<div class="scr-note small">' + esc(t('setupValid')) + '</div></div>';
      },
      init: function () {
        scr.onBack = function () { if (ON_TV) { callService('/setup/stop', function () {}); } };
        if (!ON_TV) { $('su-code').textContent = '482 913'; return; }
        callService('/setup/start', function (r) {
          if (!r.ok) { $('su-state').textContent = t('setupFail'); return; }
          $('su-code').textContent = r.pin.slice(0, 3) + ' ' + r.pin.slice(3);
          scr.timer = setInterval(function () {
            callService('/setup/status', function (st) {
              if (st.done) {
                clearInterval(scr.timer);
                scr.onBack = null;
                $('su-state').textContent = st.count + ' ' + t('setupDone') + ' ✓';
                loadCalendar(true, function () {});
              } else if (st.error) { $('su-state').textContent = t('setupFail') + ' (' + st.error + ')'; }
              else if (!st.active) { clearInterval(scr.timer); $('su-state').textContent = t('setupFail'); }
            }, 3000);
          }, 2000);
        });
      }
    }
  };

  /* ---------- Calendar on home (agenda + week strip) and idle ---------- */
  function loadCalendar(force, cb) {
    if (!ON_TV) { if (cb) { cb(); } return; }
    callService('/calendar' + (force ? '?force=1' : ''), function (r) {
      if (r.ok) {
        calData = { configured: r.configured || 0, events: r.events || [], at: r.at || Date.now() };
        store('cal', calData);
        renderAgenda();
        renderWeek();
      }
      if (cb) { cb(); }
    }, force ? 45000 : 30000);
  }
  function upcomingToday() {
    var now = Date.now(), end = dayStart(1);
    return calData.events.filter(function (e) { return e.end > now && e.start < end; });
  }
  function renderAgenda() {
    var box = $('agenda');
    if (!calData.configured) { box.hidden = true; $('idle-next').textContent = ''; return; }
    box.hidden = false;
    var h2 = t2('today');
    $('agenda-h').innerHTML = esc(t('today')) + (h2 && h2 !== t('today') ? '<span class="sec-inline">' + esc(h2) + '</span>' : '');
    var list = upcomingToday().slice(0, 3);
    $('agenda-list').innerHTML = list.length ? list.map(function (e) {
      return '<div class="ag-ev"><span class="ag-n">' + esc(evTitle(e)) + '</span><span class="ag-t">' + esc(e.allDay ? t('allDay') : hhmm(e.start)) + '</span>' + calDot(e) + '</div>';
    }).join('') : '<div class="ag-none">' + esc(t('noMore')) + '</div>';
    var now = Date.now();
    var next = calData.events.filter(function (e) { return !e.allDay && e.start > now; })[0];
    $('idle-next').textContent = next ? t('next') + ': ' + (next.start >= dayStart(1) ? t('days')[new Date(next.start).getDay()] + ' ' : '') + hhmm(next.start) + ' · ' + evTitle(next) : '';
  }
  /* Week strip: Monday to Sunday of the current week; today lights up; a dot marks days with meetings. */
  function renderWeek() {
    var now = new Date();
    var monday = dayStart(-((now.getDay() + 6) % 7));
    var html = '';
    for (var i = 0; i < 7; i++) {
      var ms = dayStart(i, monday);
      var d = new Date(ms);
      var isToday = ms === dayStart(0);
      var busy = calData.configured && eventsOnDay(ms).length > 0;
      var past = ms < dayStart(0);
      html += '<div class="wk' + (isToday ? ' today' : '') + (past ? ' past' : '') + '"><div class="wk-d">' + esc(t('daysShort')[d.getDay()]) + '</div>' +
        '<div class="wk-n">' + d.getDate() + '</div><div class="wk-dot' + (busy ? ' on' : '') + '"></div></div>';
    }
    $('week').innerHTML = html;
  }

  /* ---------- Name days ---------- */
  function showNameDays() {
    var el = $('nameday');
    if (!nameDays || theme.nameDays === false) { el.textContent = ''; return; }
    var d = new Date();
    var list = nameDays[pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())] || [];
    el.textContent = list.length ? t('nameDays') + ': ' + list.join(', ') : '';
  }

  /* ---------- Sleep badge ---------- */
  function updateSleepBadge() {
    var b = $('sleep-badge');
    if (sleepEndsAt > Date.now()) {
      b.hidden = false;
      b.textContent = t('sleepIn') + ' ' + Math.ceil((sleepEndsAt - Date.now()) / 60000) + ' ' + t('min');
    } else { b.hidden = true; }
  }

  /* ---------- Sun path (sunrise/sunset from the weather data, or calculated for the place) ---------- */
  function sunCalc(date, lat, lon) {
    var rad = Math.PI / 180;
    var jd = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12) / 86400000 + 2440587.5;
    var n = Math.round(jd - 2451545.0 + 0.0008);
    var js = n - lon / 360;
    var M = (357.5291 + 0.98560028 * js) % 360;
    var C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    var lam = (M + C + 180 + 102.9372) % 360;
    var jt = 2451545.0 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    var dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
    var cw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    if (cw > 1) { return { polar: 'night' }; }
    if (cw < -1) { return { polar: 'day' }; }
    var w = Math.acos(cw) / rad;
    return { rise: (jt - w / 360 - 2440587.5) * 86400000, set: (jt + w / 360 - 2440587.5) * 86400000 };
  }
  function localIso(s) { /* "2026-10-24T08:15" -> local ms */
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
  }
  function sunFor(dayOffset) {
    var w = store('weather');
    var dl = w && w.daily;
    var ds = dayStart(dayOffset);
    if (dl && dl.time && dl.sunrise) {
      for (var i = 0; i < dl.time.length; i++) {
        if (localIso(dl.time[i] + 'T00:00') === ds && dl.sunrise[i] && dl.sunset[i]) { return { rise: localIso(dl.sunrise[i]), set: localIso(dl.sunset[i]) }; }
      }
    }
    var cfg = theme.weather || {};
    return sunCalc(new Date(ds), +cfg.latitude || 56.95, +cfg.longitude || 24.11);
  }
  /* Horizon line; day arc above (sun travels left to right); dashed night arc below (back to sunrise).
     big = Daylight screen layout, otherwise the idle panel. */
  function drawSun(svg, cap, cap2, W, H, big) {
    if (!svg) { return; }
    var now = Date.now();
    var today = sunFor(0);
    if (today.polar) {
      svg.innerHTML = '';
      cap.textContent = today.polar === 'day' ? t('polarDay') : t('polarNight');
      if (cap2) { cap2.textContent = ''; }
      return;
    }
    var isDay = now >= today.rise && now < today.set;
    var prevSet, nextRise;
    if (now < today.rise) { var y = sunFor(-1); prevSet = y.set || today.set - 86400000; nextRise = today.rise; }
    else { var tm = sunFor(1); prevSet = today.set; nextRise = tm.rise || today.rise + 86400000; }
    var id = big ? 'b' : 's';
    var padX = big ? 190 : 104, base = big ? 300 : 150;
    var rx = (W - padX * 2) / 2, ryDay = big ? 230 : 112, ryNight = big ? 100 : 44;
    var x0 = padX, x1 = W - padX, cx = W / 2;
    function dayPt(f) { var a = Math.PI * (1 - f); return [cx + rx * Math.cos(a), base - ryDay * Math.sin(a)]; }
    function nightPt(f) { var a = Math.PI * f; return [cx + rx * Math.cos(a), base + ryNight * Math.sin(a)]; }
    var f = isDay ? (now - today.rise) / (today.set - today.rise) : (now - prevSet) / (nextRise - prevSet);
    f = Math.max(0, Math.min(1, f));
    var p = isDay ? dayPt(f) : nightPt(f);
    var px = p[0].toFixed(1), py = p[1].toFixed(1);
    var fs = big ? 30 : 22, fsm = big ? 22 : 17;
    var s = '<defs><radialGradient id="sunG' + id + '" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE7A3"/><stop offset="55%" stop-color="#EBB42C"/><stop offset="100%" stop-color="#EBB42C" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="dayF' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#EBB42C" stop-opacity=".18"/><stop offset="100%" stop-color="#EBB42C" stop-opacity="0"/></linearGradient></defs>';
    if (isDay && f > 0.002) {
      s += '<path d="M' + x0 + ' ' + base + ' A' + rx + ' ' + ryDay + ' 0 0 1 ' + px + ' ' + py + ' L' + px + ' ' + base + ' Z" fill="url(#dayF' + id + ')"/>';
    }
    s += '<path d="M' + x0 + ' ' + base + ' A' + rx + ' ' + ryDay + ' 0 0 1 ' + x1 + ' ' + base + '" fill="none" stroke="#A9BDB7" stroke-opacity=".35" stroke-width="' + (big ? 3 : 2) + '"/>';
    s += '<path d="M' + x1 + ' ' + base + ' A' + rx + ' ' + ryNight + ' 0 0 1 ' + x0 + ' ' + base + '" fill="none" stroke="#A9BDB7" stroke-opacity=".3" stroke-width="' + (big ? 2.5 : 1.6) + '" stroke-dasharray="' + (big ? '4 12' : '3 9') + '" stroke-linecap="round"/>';
    if (isDay && f > 0.002) {
      s += '<path d="M' + x0 + ' ' + base + ' A' + rx + ' ' + ryDay + ' 0 0 1 ' + px + ' ' + py + '" fill="none" stroke="#EBB42C" stroke-width="' + (big ? 5 : 3.5) + '" stroke-linecap="round"/>';
    } else if (!isDay && f > 0.002) {
      s += '<path d="M' + x1 + ' ' + base + ' A' + rx + ' ' + ryNight + ' 0 0 1 ' + px + ' ' + py + '" fill="none" stroke="#C9D6D2" stroke-opacity=".75" stroke-width="' + (big ? 3 : 2.2) + '" stroke-dasharray="' + (big ? '4 12' : '3 9') + '" stroke-linecap="round"/>';
    }
    s += '<line x1="' + x0 + '" y1="' + base + '" x2="' + x1 + '" y2="' + base + '" stroke="#A9BDB7" stroke-opacity=".55" stroke-width="' + (big ? 2 : 1.5) + '"/>';
    s += '<circle cx="' + x0 + '" cy="' + base + '" r="' + (big ? 7 : 5) + '" fill="#012B28" stroke="#A9BDB7" stroke-width="2"/>';
    s += '<circle cx="' + x1 + '" cy="' + base + '" r="' + (big ? 7 : 5) + '" fill="#012B28" stroke="#A9BDB7" stroke-width="2"/>';
    /* labels sit outside the arc ends, centred on the horizon, clear of the night arc */
    var gap = big ? 26 : 16, ly = base - 4;
    function txt(x, yy, size, weight, fill, str, anchor, extra) {
      return '<text x="' + x + '" y="' + yy + '" text-anchor="' + (anchor || 'middle') + '" font-family="Manrope, Arial, sans-serif" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '"' + (extra || '') + '>' + esc(str) + '</text>';
    }
    s += txt(x0 - gap, ly, fs, 700, '#F4F2EC', hhmm(today.rise), 'end') + txt(x0 - gap, ly + fsm + 6, fsm, 500, '#A9BDB7', t('sunrise'), 'end');
    s += txt(x1 + gap, ly, fs, 700, '#F4F2EC', hhmm(today.set), 'start') + txt(x1 + gap, ly + fsm + 6, fsm, 500, '#A9BDB7', t('sunset'), 'start');
    s += txt(cx, base - (big ? 84 : 52), fsm, 600, '#A9BDB7', t('daylight').toUpperCase(), 'middle', ' letter-spacing="3"');
    s += '<text x="' + cx + '" y="' + (base - (big ? 26 : 16)) + '" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="' + (big ? 56 : 34) + '" font-weight="600" fill="#F4F2EC" style="font-variant-numeric:lining-nums">' + esc(dur(today.set - today.rise)) + '</text>';
    if (isDay) {
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 48 : 30) + '" fill="url(#sunG' + id + ')" opacity=".6"/>';
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 15 : 10) + '" fill="#F6C94E" stroke="#FFF1C2" stroke-width="2"/>';
    } else {
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 13 : 9) + '" fill="#F4F2EC" opacity=".92"/>';
      s += '<circle cx="' + (p[0] + (big ? 6 : 4)).toFixed(1) + '" cy="' + (p[1] - (big ? 4 : 3)).toFixed(1) + '" r="' + (big ? 11 : 7.5) + '" fill="#011B18"/>';
    }
    svg.innerHTML = s;
    cap.textContent = isDay ? t('sunsetIn') + ' ' + dur(today.set - now) : t('sunriseIn') + ' ' + dur(nextRise - now) + ' · ' + hhmm(nextRise);
    if (cap2) {
      cap2.textContent = !hasSecond() ? '' : isDay ? tl(prefs.lang2, 'sunsetIn') + ' ' + durL(prefs.lang2, today.set - now)
        : tl(prefs.lang2, 'sunriseIn') + ' ' + durL(prefs.lang2, nextRise - now);
    }
  }
  function renderSun() { drawSun($('sun-svg'), $('sun-cap'), null, 724, 250, false); }

  /* ---------- Idle (I3) + night ---------- */
  function idleSeconds() { return theme && typeof theme.idleSeconds === 'number' ? theme.idleSeconds : 20; }
  function armIdle() {
    clearTimeout(idleTimer);
    var s = idleSeconds();
    if (s <= 0 || document.hidden) { return; }
    idleTimer = setTimeout(function () { if (mode === 'home') { forceNight = false; enterIdle(); } }, s * 1000);
  }
  function minutesOf(hm) { var p = String(hm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function nightLabel() { var n = theme.night || {}; return (n.from || '22:00') + '–' + (n.to || '07:00'); }
  function isNight() {
    if (!prefs.night) { return false; }
    var n = theme.night || {};
    var from = minutesOf(n.from || '22:00'), to = minutesOf(n.to || '07:00');
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    return from > to ? (m >= from || m < to) : (m >= from && m < to);
  }
  function enterIdle() {
    if (mode === 'drawer' || mode === 'rdrawer') { hideDrawers(); }
    if (mode === 'card') { $('card').hidden = true; }
    if (mode === 'all') { $('all').hidden = true; }
    if (mode === 'scr') { clearInterval(scr.timer); if (scr.onBack) { scr.onBack(); } $('scr').hidden = true; }
    blurHome();
    mode = 'idle';
    renderAgenda();
    renderSun();
    setStageClass();
  }
  function leaveIdle() {
    mode = 'home';
    forceNight = false;
    setStageClass();
    setFocus(pos.r, pos.c);
    armIdle();
  }

  /* ---------- Keys ---------- */
  function onKey(e) {
    var k = e.keyCode;
    var handled = [KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN, KEY.ENTER, KEY.BACK, KEY.ESC, KEY.BACKSPACE].indexOf(k) >= 0;
    if (handled) { e.preventDefault(); }
    if (mode === 'idle') { leaveIdle(); return; }
    armIdle();
    if (mode === 'card') { if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE || k === KEY.ENTER) { closeCard(); } return; }
    if (mode === 'all') { allKey(k); return; }
    if (mode === 'scr') { scrKey(k); return; }
    if (mode === 'drawer') {
      if (k === KEY.UP) { mpos = setListFocus(menu, mpos, mpos - 1); }
      else if (k === KEY.DOWN) { mpos = setListFocus(menu, mpos, mpos + 1); }
      else if (k === KEY.RIGHT || k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closeDrawer(); }
      else if (k === KEY.ENTER) { runTarget(menu[mpos].id); }
      return;
    }
    if (mode === 'rdrawer') {
      if (k === KEY.UP) { rpos = setListFocus(rmenu, rpos, rpos - 1); }
      else if (k === KEY.DOWN) { rpos = setListFocus(rmenu, rpos, rpos + 1); }
      else if (k === KEY.LEFT || k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closeRDrawer(); }
      else if (k === KEY.ENTER) { runTarget(rmenu[rpos].id); }
      return;
    }
    switch (k) {
      case KEY.LEFT: if (pos.c === 0) { openDrawer(); } else { setFocus(pos.r, pos.c - 1); } break;
      case KEY.RIGHT: if (pos.c === rows[pos.r].length - 1) { openRDrawer(); } else { setFocus(pos.r, pos.c + 1); } break;
      case KEY.UP: moveVertical(-1); break;
      case KEY.DOWN: moveVertical(1); break;
      case KEY.ENTER: runTarget(rows[pos.r][pos.c].id); break;
      default: break; /* Back on home does nothing: no accidental exit. */
    }
  }

  /* ---------- Watch (CLK-4) + digital face ---------- */
  var SHADOW = { hour: [2.6, 5.2], minute: [4.16, 7.8], second: [5.72, 10.4], small: [1.04, 2.08] };
  var hands = null, lastDay = -1, lastHour = -1, lastMin = -1, tickTimer = null;

  function turn(el, deg, sh) {
    var tr = (sh ? 'translate(' + sh[0] + 'px,' + sh[1] + 'px) ' : '') + 'rotate(' + deg.toFixed(2) + 'deg)';
    el.style.transform = tr;
    el.style.webkitTransform = tr;
  }
  function moonPath(frac) {
    var cx = 50, cy = 50, r = 32;
    var rx = Math.abs(Math.cos(2 * Math.PI * frac)) * r;
    var f = (1 - Math.cos(2 * Math.PI * frac)) / 2;
    if (f < 0.01) { return ''; }
    var top = cx + ' ' + (cy - r), bot = cx + ' ' + (cy + r);
    if (frac < 0.5) { return 'M' + top + ' A' + r + ' ' + r + ' 0 0 1 ' + bot + ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + (f < 0.5 ? 0 : 1) + ' ' + top + ' Z'; }
    return 'M' + top + ' A' + r + ' ' + r + ' 0 0 0 ' + bot + ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + (f < 0.5 ? 1 : 0) + ' ' + top + ' Z';
  }
  function updateGreeting(h) {
    var gi = greetIndex(h);
    var n1 = nameFor(prefs.lang);
    $('greeting').textContent = dict(prefs.lang).greet[gi] + (n1 ? ',' : '');
    $('name').textContent = n1;
    if (hasSecond()) {
      var n2 = nameFor(prefs.lang2);
      $('greeting2').textContent = dict(prefs.lang2).greet[gi] + (n2 ? ', ' + n2 : '');
    } else { $('greeting2').textContent = ''; }
  }
  function tick() {
    clearTimeout(tickTimer);
    if (document.hidden || !hands) { return; }
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    var daySec = h * 3600 + m * 60 + s;
    var showSec = !(theme.clock && theme.clock.secondHand === false) && prefs.face !== 'digital';
    if (prefs.face !== 'digital') {
      turn(hands.hour, daySec / 120); turn(hands.hourS, daySec / 120, SHADOW.hour);
      turn(hands.min, daySec / 10); turn(hands.minS, daySec / 10, SHADOW.minute);
      if (showSec) { turn(hands.sec, s * 6); turn(hands.secS, s * 6, SHADOW.second); }
    }
    if (m !== lastMin) {
      lastMin = m;
      $('dg-time').textContent = pad2(h) + ':' + pad2(m);
      if (mode === 'idle') { setStageClass(); renderAgenda(); }
      renderSun();
      updateSleepBadge();
    }
    if (d.getDate() !== lastDay) {
      lastDay = d.getDate();
      turn(hands.day, d.getDay() * 360 / 7); turn(hands.dayS, d.getDay() * 360 / 7, SHADOW.small);
      turn(hands.date, (d.getDate() - 1) * 360 / 31); turn(hands.dateS, (d.getDate() - 1) * 360 / 31, SHADOW.small);
      var ds = formatDateL(prefs.lang, d);
      $('date').textContent = ds;
      $('idle-date').textContent = ds;
      $('idle-date2').textContent = hasSecond() ? formatDateL(prefs.lang2, d) : '';
      $('dg-day').textContent = t('days')[d.getDay()] + ' ' + d.getDate() + (prefs.lang === 'lv' ? '.' : '');
      showNameDays();
      renderWeek();
      loadCalendar(false);
    }
    if (h !== lastHour) { lastHour = h; var age = (((d.getTime() / 86400000 - 10962.76) % 29.530588) + 29.530588) % 29.530588; $('moon-path').setAttribute('d', moonPath(age / 29.530588)); updateGreeting(h); }
    var wait = showSec ? 1000 - d.getMilliseconds() : (60 - s) * 1000 - d.getMilliseconds();
    tickTimer = setTimeout(tick, Math.max(200, wait));
  }
  function initWatch() {
    hands = { hour: $('h-hour'), hourS: $('h-hour-s'), min: $('h-min'), minS: $('h-min-s'), sec: $('h-sec'), secS: $('h-sec-s'),
      day: $('h-day'), dayS: $('h-day-s'), date: $('h-date'), dateS: $('h-date-s') };
    if (theme.clock && theme.clock.secondHand === false) { hands.sec.style.display = 'none'; hands.secS.style.display = 'none'; }
  }

  /* ---------- Weather (Open-Meteo, cached) ---------- */
  var weatherTimer = null;
  function wxIcon(code, isDay) {
    if (code === 0 || code === 1) { return isDay === 0 ? WX.moon : WX.sun; }
    if (code === 2) { return isDay === 0 ? WX.cloud : WX.partly; }
    if (code === 3) { return WX.cloud; }
    if (code === 45 || code === 48) { return WX.fog; }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) { return WX.snow; }
    if (code >= 95) { return WX.storm; }
    if (code >= 51) { return WX.rain; }
    return WX.cloud;
  }
  function showWeather(w, stale) {
    var place = (theme.weather && theme.weather.place) || '';
    var text, icon, word2 = '';
    if (!w) { text = place + ' · ' + t('wxNA'); icon = WX.cloud; }
    else {
      text = place + ' · ' + Math.round(w.t) + '°C · ' + wmo(w.code) + (stale ? ' · ' + t('offline') : '');
      icon = wxIcon(w.code, w.day);
      if (hasSecond()) { word2 = wmoL(prefs.lang2, w.code); }
    }
    $('weather').textContent = text;
    $('wx-icon').innerHTML = icon;
    $('idle-weather').textContent = text;
    $('idle-wx').innerHTML = icon;
    $('date2').textContent = hasSecond() ? formatDateL(prefs.lang2, new Date()) + (word2 ? ' · ' + word2 : '') : '';
  }
  function weather(force) {
    var cfg = theme.weather || {};
    clearTimeout(weatherTimer);
    if (!cfg.enabled) { $('weather').textContent = ''; return; }
    var maxAge = (cfg.cacheMinutes || 30) * 60000;
    var cached = store('weather');
    if (!force && cached && cached.daily && Date.now() - cached.at < maxAge) {
      showWeather(cached, false);
      weatherTimer = setTimeout(weather, maxAge - (Date.now() - cached.at) + 1000);
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.latitude + '&longitude=' + cfg.longitude +
      '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=3&timezone=auto';
    getJSON(url, function (err, data) {
      if (!err && data && data.current) {
        var dl = data.daily || {};
        var w = { t: data.current.temperature_2m, code: data.current.weather_code, day: data.current.is_day, at: Date.now(),
          daily: dl.time ? { time: dl.time, code: dl.weather_code, max: dl.temperature_2m_max, min: dl.temperature_2m_min, sunrise: dl.sunrise, sunset: dl.sunset } : null };
        store('weather', w);
        showWeather(w, false);
        renderSun();
      } else {
        showWeather(cached, true);
      }
      weatherTimer = setTimeout(weather, maxAge);
    }, 10000);
  }

  /* ---------- Back from another app ---------- */
  function onVisibility() {
    if (document.hidden) { clearTimeout(idleTimer); clearTimeout(tickTimer); return; }
    if (mode === 'idle') { leaveIdle(); }
    lastDay = -1; lastHour = -1; lastMin = -1;
    tick();
    weather(false);
    loadCalendar(false);
    pollSleep();
    armIdle();
  }
  function pollSleep() {
    if (!ON_TV) { updateSleepBadge(); return; }
    callService('/sleep', function (r) { if (r.ok) { sleepEndsAt = r.endsAt || 0; updateSleepBadge(); } }, 4000);
  }

  /* ---------- PC preview scaling ---------- */
  function fit() {
    if (ON_TV) { return; }
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
    document.body.style.width = document.documentElement.style.width = (1920 * s) + 'px';
    document.body.style.height = document.documentElement.style.height = (1080 * s) + 'px';
  }

  /* ---------- Start ---------- */
  function start() {
    loadPrefs();
    applyTheme();
    var c = store('cal');
    if (c && c.events) { calData = c; }
    initWatch();
    buildRows();
    var saved = store('focus');
    pos = saved && rows[saved.r] && rows[saved.r][saved.c] ? saved : { r: 0, c: 0 };
    refreshAll();
    weather(false);
    loadCalendar(false);
    pollSleep();
    setInterval(function () { if (!document.hidden) { loadCalendar(false); pollSleep(); } }, 5 * 60000);
    getJSON('data/namedays-lv.json?v=' + VERSION, function (err, d) { if (!err && d) { nameDays = d; showNameDays(); } });
    armIdle();
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    $('edge').addEventListener('click', openDrawer);
    $('edge-r').addEventListener('click', openRDrawer);
    $('drawer').addEventListener('click', function (e) { if (/drawer-dim/.test(e.target.className)) { closeDrawer(); } });
    $('rdrawer').addEventListener('click', function (e) { if (/drawer-dim/.test(e.target.className)) { closeRDrawer(); } });
    $('stage').addEventListener('click', function () { if (mode === 'idle') { leaveIdle(); } });
    if (!ON_TV) {
      $('badge').hidden = false;
      document.body.style.cursor = 'default';
      window.addEventListener('resize', fit);
      fit();
    }
  }
  function load() {
    var inline = window.GREENWOOD_INLINE;
    if (inline) { theme = inline.theme; apps = inline.apps; start(); return; }
    getJSON('theme.json?v=' + VERSION, function (err, th) {
      if (err) { toast('theme.json could not be read'); return; }
      theme = th;
      getJSON('apps.json?v=' + VERSION, function (err2, a) { apps = err2 ? {} : a; start(); });
    });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', load); } else { load(); }
})();
