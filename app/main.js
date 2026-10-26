/* Greenwood Hub — TizenBrew app module for UE55RU7172 (Tizen 5.0, Chromium M63).
 * ES2017 max: no optional chaining, no nullish coalescing, no ES modules. Animate transform/opacity only.
 * Outbound: Open-Meteo weather; calendar links are read by service.js. Files come via jsDelivr (TizenBrew).
 * Apps, icons, keys, calendar, sleep timer and status go through service.js on 127.0.0.1:8095.
 * Texts: i18n.js (en, lv, fr). No telemetry, no ads, no remote code.
 */
(function () {
  'use strict';

  var VERSION = '0.7.6';
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
  var updInfo = null; /* answer of /update/check */

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
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l9-5"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6 12h4M6 15h4"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
    updates: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/><path d="M12 8v5l3 2"/></svg>',
    setup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="13" rx="2"/><path d="M3 9.5h13M7 3v4M12 3v4"/><path d="M17.5 14.5a4 4 0 0 1 3.5 0M16.2 12.3a7 7 0 0 1 6.1 0"/><circle cx="19.25" cy="17.25" r="0.9" fill="currentColor" stroke="none"/></svg>',
    tvinfo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M7 12l3-3 2 2 4-4"/></svg>'
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
    updateUpdBadge();
    showWeather(store('weather'), false);
    renderSun();
  }

  /* ---------- Home tiles ---------- */
  function iconFor(id) { return id.indexOf('hdmi') === 0 ? ICONS.hdmi : (ICONS[id] || ''); }
  var SPECIAL = { iphone: 1, apps: 1, idle: 1, night: 1, calendar: 1, weather: 1, daylight: 1, look: 1, sleep: 1, about: 1, updates: 1, tvinfo: 1, radio: 1, 'qp-toggle': 1, 'qp-pick': 1 };
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
    var qh = $('row-qp');
    qh.innerHTML = '';
    var qrow = [];
    var tg = document.createElement('div');
    tg.className = 't qp-tile'; tg.id = 'qp-toggle';
    tg.innerHTML = '<span class="qp-ic"></span><span class="qp-tx"><span class="qp-nm"></span><span class="qp-st"></span></span><span class="qp-eq"><i></i><i></i><i></i><i></i></span>';
    qh.appendChild(tg); qrow.push({ id: 'qp-toggle', el: tg, kind: 'qp', label: t('radioTitle') });
    var pk = document.createElement('div');
    pk.className = 't qp-pick'; pk.innerHTML = ICONS.radio + '<span>' + esc(t('qpStations')) + '</span>';
    qh.appendChild(pk); qrow.push({ id: 'qp-pick', el: pk, kind: 'qp', label: t('qpStations') });
    var defs = [
      { list: theme.watch || [], host: 'row-watch', kind: 'app' },
      { list: theme.connect || [], host: 'row-connect', kind: 'pill' }
    ];
    rows = [qrow];
    defs.forEach(function (d) {
      var host = $(d.host);
      host.innerHTML = '';
      var row = d.list.map(function (item) { var tile = makeTile(item, d.kind); host.appendChild(tile.el); return tile; });
      if (row.length) { rows.push(row); }
    });
    renderRadio();
    var mh = $('menu');
    mh.innerHTML = '';
    var lastGroup = '';
    menu = (theme.menu || []).map(function (item) {
      if (lastGroup && item.group !== lastGroup) { var sep = document.createElement('div'); sep.className = 'mi-sep'; mh.appendChild(sep); }
      lastGroup = item.group || 'hub';
      var tile = makeTile(item, 'menu');
      if (item.id === 'updates') { tile.el.insertAdjacentHTML('beforeend', '<span class="mi-badge" id="mi-upd"></span>'); }
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

  var wifiNeedsSetup = false;
  function openCard() { mode = 'card'; wifiNeedsSetup = false; $('card').hidden = false; paintWifi(); }
  /* Wi-Fi QR on the iPhone card: the helper builds the standard WIFI: text from the network name the TV reports
     and the password saved once from the phone setup page (kept only on the TV). */
  function drawWifi(r) {
    var qr = $('cw-qr');
    $('cw-ssid').textContent = r && r.ssid ? r.ssid : '\u2014';
    $('cw-pw').textContent = r && r.pass ? r.pass : '';
    $('cw-pwrow').style.display = r && r.pass ? '' : 'none';
    $('cw-rows').style.display = r && r.ssid ? '' : 'none';
    if (r && r.qr && window.qrcode) {
      try { var q = window.qrcode(0, 'M'); q.addData(r.qr); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (e) { qr.innerHTML = ''; }
      qr.className = 'cw-qr';
      $('cw-note').textContent = t('wifiScan');
    } else {
      qr.innerHTML = ICONS.iphone; qr.className = 'cw-qr empty';
      $('cw-note').textContent = r && r.ssid ? t('wifiPress') : t('wifiNone');
      wifiNeedsSetup = !!(r && r.ssid);
    }
  }
  function paintWifi() {
    if (!ON_TV) { drawWifi({ ssid: 'Greenwood Home', pass: 'example-only-2026', qr: 'WIFI:T:WPA;S:Greenwood Home;P:example-only-2026;;' }); return; }
    callService('/wifi', function (r) { drawWifi(r.ok ? r : null); }, 4000);
  }
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
    radioStop();
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
    if (/HDMI|SOURCE|HOME|MENU/.test(keyCode)) { radioStop(); }
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
    if (id === 'qp-toggle') { radioToggle(); return; }
    if (id === 'qp-pick') { openScreen('radio'); return; }
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
    var show = apps._show && apps._show.length ? apps._show : null;
    if (show) { list = list.filter(function (a) { return show.indexOf(a.id) >= 0; }); }
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
    pollStats();
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
  function closeAll() { mode = 'home'; $('all').hidden = true; clearTimeout(statsTimer); setFocus(pos.r, pos.c); }
  /* TV stats bar on All apps: storage, memory, processor (service.js /stats), every 3 s while the screen is open */
  var statsTimer = null;
  function gb(bytes) { return (bytes / 1073741824).toFixed(1).replace('.', t('decimal') || '.') + ' GB'; }
  function meter(id, label, value, frac) {
    var pct = Math.max(0, Math.min(1, frac || 0));
    var el = $(id);
    el.className = 'st-c' + (pct >= 0.85 ? ' hot' : '');
    el.innerHTML = '<div class="st-top"><span class="st-k">' + esc(label) + '</span><span class="st-v">' + esc(value) + '</span></div>' +
      '<div class="st-bar"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></div>';
  }
  function paintStats(s) {
    if (!s) { $('all-stats').className = 'all-stats off'; return; }
    $('all-stats').className = 'all-stats';
    if (s.storage) { meter('st-storage', t('stStorage'), fmt(t('stFree'), gb(s.storage.free)).replace('{t}', gb(s.storage.total)), 1 - s.storage.free / s.storage.total); }
    if (s.mem) { meter('st-mem', t('stMemory'), fmt(t('stUsed'), gb(s.mem.total - s.mem.avail)).replace('{t}', gb(s.mem.total)), 1 - s.mem.avail / s.mem.total); }
    if (s.cpu !== undefined && s.cpu !== null) { meter('st-cpu', t('stCpu'), Math.round(s.cpu * 100) + '%', s.cpu); }
  }
  function pollStats() {
    clearTimeout(statsTimer);
    if (mode !== 'all') { return; }
    if (!ON_TV) { paintStats({ storage: { free: 2.4 * 1073741824, total: 4.6 * 1073741824 }, mem: { total: 2.5 * 1073741824, avail: 1.3 * 1073741824 }, cpu: 0.18 }); return; }
    callService('/stats', function (r) { paintStats(r.ok ? r : null); statsTimer = setTimeout(pollStats, 3000); }, 4000);
  }
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
        var place = (theme.weather && theme.weather.place) || '';
        if (!w || !w.daily) { return '<div class="scr-empty"><div class="scr-big">' + esc(place + ' · ' + t('wxNA')) + '</div></div>'; }
        var d = w.daily, hrs = wxHours(w, 24);
        /* hero */
        var feels = w.feels !== undefined ? Math.round(w.feels) : null;
        var hero = '<div class="wh-hero"><div class="wh-ic">' + wxIcon(w.code, w.day) + '</div><div class="wh-now">' +
          '<div class="wh-t">' + Math.round(w.t) + '°</div><div class="wh-c">' + esc(wmo(w.code)) +
          (hasSecond() ? '<span class="sec-inline">' + esc(wmoL(prefs.lang2, w.code)) + '</span>' : '') + '</div>' +
          '<div class="wh-hl">' + (feels !== null ? esc(fmt(t('wxFeels'), feels)) + ' · ' : '') + '↑ ' + Math.round(d.max[0]) + '°  ↓ ' + Math.round(d.min[0]) + '°</div></div>' +
          '<div class="wh-sum">' + wxSummary(w).map(function (s) { return '<div class="wh-line">' + s + '</div>'; }).join('') + '</div></div>';
        /* details */
        function tile(icon, k, v, sub) { return '<div class="wd"><div class="wd-k">' + icon + esc(t(k)) + '</div><div class="wd-v">' + v + '</div>' + (sub ? '<div class="wd-s">' + esc(sub) + '</div>' : '') + '</div>'; }
        var det = '<div class="wh-det">' +
          tile(WI.wind, 'wxWind', (w.wind !== undefined ? Math.round(w.wind) : '–') + '<small> m/s</small>' + (w.dir !== undefined ? '<i class="wd-arrow" style="transform:rotate(' + Math.round(w.dir + 180) + 'deg)">↑</i>' : ''),
            (w.gust !== undefined ? fmt(t('wxGusts'), Math.round(w.gust)) : '') + (w.dir !== undefined ? ' · ' + compass(w.dir) : '')) +
          tile(WI.drop, 'wxRainToday', (d.psum ? (Math.round(d.psum[0] * 10) / 10) : 0) + '<small> mm</small>', d.ppmax ? fmt(t('wxChance'), d.ppmax[0]) : '') +
          tile(WI.hum, 'wxHumidity', (w.hum !== undefined ? Math.round(w.hum) : '–') + '<small>%</small>', '') +
          tile(WI.uv, 'wxUV', d.uvmax ? Math.round(d.uvmax[0]) : '–', d.uvmax ? uvLabel(d.uvmax[0]) : '') +
          tile(WI.gauge, 'wxPressure', (w.pres !== undefined ? Math.round(w.pres) : '–') + '<small> hPa</small>', '') +
          tile(WI.sun, 'wxSun', d.sunrise && d.sunrise[0] ? d.sunrise[0].slice(11, 16) + '<small> – </small>' + d.sunset[0].slice(11, 16) : '–', d.sunrise && d.sunrise[0] ? dur(localMs(d.sunset[0]) - localMs(d.sunrise[0])) : '') +
          '</div>';
        /* week */
        var lo = Math.min.apply(null, d.min), hi = Math.max.apply(null, d.max), span = Math.max(1, hi - lo);
        var week = '<div class="wk7">';
        for (var i = 0; i < Math.min(7, d.time.length); i++) {
          var dt = new Date(d.time[i] + 'T12:00:00');
          var l = (d.min[i] - lo) / span * 100, r = (d.max[i] - lo) / span * 100;
          week += '<div class="w7 fx"><div class="w7-d">' + esc(i === 0 ? t('todayT') : t('daysShort')[dt.getDay()]) + '</div><div class="w7-ic">' + wxIcon(d.code[i], 1) + '</div>' +
            '<div class="w7-p">' + (d.ppmax && d.ppmax[i] >= 20 ? WI.drop + d.ppmax[i] + '%' : '&nbsp;') + '</div>' +
            '<div class="w7-t"><b>' + Math.round(d.max[i]) + '°</b> ' + Math.round(d.min[i]) + '°</div>' +
            '<div class="w7-bar"><i style="left:' + l.toFixed(0) + '%;width:' + Math.max(6, r - l).toFixed(0) + '%"></i></div></div>';
        }
        week += '</div>';
        return '<div class="wx2">' + hero + det + '<div class="wx-sec">' + esc(t('wxNext24')) + '</div><svg class="wx-chart" id="wx-chart" viewBox="0 0 1728 240" width="1728" height="240"></svg>' + week + '</div>';
      },
      init: function () { drawWxChart($('wx-chart'), wxHours(store('weather'), 24)); }
    },
    daylight: {
      title: function (lang) { return tl(lang, 'dlTitle'); },
      html: function () {
        return '<div class="dl2">' +
          '<div class="dl-left" id="dl-left"></div>' +
          '<div class="dl-mid"><svg class="dl-arc" id="dl-svg" viewBox="0 0 1060 600" width="1060" height="600"></svg>' +
            '<div class="globe-wrap" id="globe-wrap"><canvas id="globe" width="400" height="400"></canvas><div class="globe-rim"></div><div class="globe-tag">' + esc((theme.weather && theme.weather.place) || '') + '</div></div>' +
            '<div class="dl-cap" id="dl-cap"></div><div class="dl-cap2" id="dl-cap2"></div></div>' +
          '<div class="dl-right" id="dl-right"></div>' +
          '<div class="dl-year"><div class="dl-year-k">' + esc(t('dlYear')) + '</div><svg id="dl-year" viewBox="0 0 1728 120" width="1728" height="120"></svg></div>' +
          '</div>';
      },
      init: function () {
        function paint() {
          drawSun($('dl-svg'), $('dl-cap'), $('dl-cap2'), 1060, 600, 'globe');
          paintSunFacts($('dl-left'));
          paintMoon($('dl-right'));
          paintYear($('dl-year'));
        }
        paint();
        globeStart($('globe'));
        scr.timer = setInterval(paint, 60000);
        scr.onBack = globeStop;
      }
    },
    radio: {
      title: function (lang) { return tl(lang, 'radioTitle'); },
      html: function () {
        return '<div class="rd">' + radio.groups.map(function (g) {
          return '<div class="rd-g"><div class="rd-gk">' + esc(t('rg_' + g.id)) + '</div><div class="rd-row">' + g.stations.map(function (s) {
            var cur = radio.cur && radio.cur.id === s.id;
            return '<div class="rd-st fx' + (cur ? ' sel' : '') + '" data-act="play" data-v="' + esc(s.id) + '"><div class="rd-nm">' + esc(s.name) + '</div><div class="rd-sub">' +
              esc(cur && radio.state !== 'off' ? t('radioOn') : s.sub || '') + '</div></div>';
          }).join('') + '</div></div>';
        }).join('') + '<div class="scr-note small">' + esc(t('radioNote')) + '</div></div>';
      },
      init: function () {
        var sel = $('scr-body').querySelector('.rd-st.sel');
        if (sel) { setScrFocus(scr.fx.indexOf(sel)); }
      },
      act: function (a, v) {
        var st = radio.list.filter(function (s) { return s.id === v; })[0];
        if (st) { radioPlay(st); closeScreen(); }
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
        var ub = updInfo && updInfo.newer
          ? '<div class="btn btn-gold fx" data-act="go" data-v="updates">' + esc(fmt(t('updAvailable'), updInfo.latest)) + ' \u203A</div>'
          : '<div class="btn fx" data-act="go" data-v="updates">' + esc(t('m_updates')) + ' \u203A</div>';
        ub += '<div class="btn fx" data-act="go" data-v="tvinfo">' + esc(t('m_tvinfo')) + ' \u203A</div>';
        return '<div class="ab"><div class="ab-rows" id="ab-rows"></div><div class="ab-btns">' + ub +
          '<div class="btn fx" data-act="setup">' + esc(t('calConnect')) + '</div>' +
          '<div class="btn fx" data-act="keytest">' + esc(t('keyTest')) + '</div>' +
          (function () { var st = store('soundTest'); return '<div class="btn fx" data-act="soundtest">' + esc(t('soundTest') + (st ? ' \u00B7 ' + (st.ok ? '\u2713' : '\u2717 ' + st.result) : '')) + '</div>'; })() +
          '<div class="btn fx" data-act="refresh">' + esc(t('calRefresh')) + '</div>' +
          (calData.configured ? '<div class="btn fx" data-act="forget">' + esc(t('calForget')) + '</div>' : '') + '</div></div>';
      },
      init: function () {
        function row(k, v, st, cls) { return '<div class="ab-row' + (cls ? ' ' + cls : '') + '"><i class="st st-' + st + '"></i><span class="ab-k">' + esc(k) + '</span><span class="ab-v">' + esc(v) + '</span></div>'; }
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
          html += row(t('a_network'), s && s.ip ? s.ip : '\u2014', s && s.ip ? 'ok' : 'warn');
          if (s) {
            var kl = s.keyLog && s.keyLog.length ? s.keyLog[s.keyLog.length - 1] : '';
            html += row(t('a_lastKey'), kl ? kl.slice(0, 64) : '\u2014', !kl ? 'warn' : /^\S+ ok /.test(kl) ? 'ok' : 'bad');
            html += row(t('a_apps'), s.appsFrom === 'samsung' ? t('appsSamsung') : s.appsFrom === 'tizen' ? t('appsTizen') : '\u2014', s.appsFrom === 'samsung' ? 'ok' : 'warn');
          }
          var rl = radio.last || store('radioLast');
          html += row(t('a_radio'), rl ? rl.name + ' \u00B7 ' + rl.result + ' \u00B7 ' + agoText(rl.at) : '\u2014', !rl ? 'warn' : /^playing/.test(rl.result) ? 'ok' : 'bad', 'ab-two');
          html += row(t('a_updates'), !updInfo ? '\u2014' : updInfo.newer ? fmt(t('updAvailable'), updInfo.latest) : t('updUpToDate') + ' \u00B7 v' + VERSION, updInfo && updInfo.newer ? 'warn' : 'ok');
          $('ab-rows').innerHTML = html;
        }
        paint(null);
        if (ON_TV) { callService('/status', function (r) { if (scr.id === 'about') { paint(r.ok ? r : null); } }, 4000); }
      },
      act: function (a, v) {
        if (a === 'go') { renderScreen(v, 0); }
        else if (a === 'setup') { renderScreen('setup'); }
        else if (a === 'check') { checkUpdate(true, function () { if (scr.id === 'about') { renderScreen('about', 0); } toast(updInfo && updInfo.newer ? fmt(t('updAvailable'), updInfo.latest) : t('updUpToDate')); }); }
        else if (a === 'update') { runUpdate(v); }
        else if (a === 'soundtest') { toast(t('soundPlaying')); soundTest(function () { if (scr.id === 'about') { renderScreen('about', scr.f); } }); }
        else if (a === 'keytest') {
          if (!ON_TV) { toast(t('keyTestOk')); return; }
          callService('/key?k=KEY_VOLUP', function (r1) {
            if (!r1.ok) { toast(fmt(t('keyTestFail'), (r1.error || '?') + (r1.detail ? ' / ' + r1.detail : ''))); renderScreen('about', scr.f); return; }
            callService('/key?k=KEY_VOLDOWN', function () { toast(t('keyTestOk')); renderScreen('about', scr.f); }, 70000);
          }, 70000);
        }
        else if (a === 'refresh') { loadCalendar(true, function () { toast(t('calRefresh') + ' ✓'); if (scr.id === 'about') { renderScreen('about', scr.f); } }); }
        else if (a === 'forget') { callService('/setup/forget', function () { calData = { configured: 0, events: [], at: 0 }; store('cal', calData); renderAgenda(); renderWeek(); renderScreen('about', 0); }); }
      }
    },
    updates: {
      title: function (lang) { return tl(lang, 'm_updates'); },
      html: function () {
        var u = updInfo || { current: VERSION, newer: false, latest: '', previous: '' };
        var newer = !!u.newer;
        var st = newer ? fmt(t('updAvailable'), u.latest) : t('updUpToDate');
        var btns = newer ? '<div class="btn btn-gold fx" data-act="install" data-v="' + esc(u.latest) + '">' + esc(fmt(t('updInstall'), u.latest)) + '</div>' : '';
        btns += '<div class="btn fx" data-act="check">' + esc(t('updCheck')) + '</div>';
        if (u.previous && u.previous !== 'v' + VERSION) { btns += '<div class="btn fx" data-act="install" data-v="' + esc(u.previous) + '">' + esc(fmt(t('updPrev'), u.previous)) + '</div>'; }
        return '<div class="ud"><div class="ud-l"><div class="ud-k">' + esc(t('udInstalled')) + '</div><div class="ud-v">' + esc(VERSION) + '</div>' +
          '<div class="ud-st' + (newer ? ' new' : '') + '"><i></i>' + esc(st) + '</div><div class="ud-btns">' + btns + '</div></div>' +
          '<div class="ud-r"><div class="ud-k">' + esc(t('udHow')) + '</div><ol class="ud-steps"><li>' + esc(t('udStep1')) + '</li><li>' + esc(t('udStep2')) + '</li><li>' + esc(t('udStep3')) + '</li></ol></div></div>';
      },
      act: function (a, v) {
        if (a === 'install') { runUpdate(v); }
        else if (a === 'check') { checkUpdate(true, function () { if (scr.id === 'updates') { renderScreen('updates', 0); } toast(updInfo && updInfo.newer ? fmt(t('updAvailable'), updInfo.latest) : t('updUpToDate')); }); }
      }
    },
    tvinfo: {
      title: function (lang) { return tl(lang, 'm_tvinfo'); },
      html: function () {
        function ring(id, k) {
          return '<div class="ti-g" id="ti-' + id + '"><svg viewBox="0 0 200 200" width="200" height="200"><circle cx="100" cy="100" r="84" fill="none" stroke="rgba(169,189,183,.18)" stroke-width="14"/>' +
            '<circle class="ti-arc" cx="100" cy="100" r="84" fill="none" stroke="#EBB42C" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 528" transform="rotate(-90 100 100)"/></svg>' +
            '<div class="ti-pc">\u2014</div><div class="ti-k">' + esc(t(k)) + '</div><div class="ti-d">\u00A0</div></div>';
        }
        return '<div class="ti"><div class="ti-rows ab-rows" id="ti-rows"></div><div class="ti-gs">' + ring('storage', 'stStorage') + ring('mem', 'stMemory') + ring('cpu', 'stCpu') + '</div></div>';
      },
      init: function () {
        function row(k, v, st) { return '<div class="ab-row"><i class="st st-' + st + '"></i><span class="ab-k">' + esc(k) + '</span><span class="ab-v">' + esc(v) + '</span></div>'; }
        function paintInfo(i, s) {
          var h = row(t('tiModel'), i.model || '\u2014', i.model ? 'ok' : 'warn') + row(t('tiSystem'), i.platform ? 'Tizen ' + i.platform : '\u2014', i.platform ? 'ok' : 'warn') +
            row(t('tiScreen'), i.width ? i.width + ' \u00D7 ' + i.height : '\u2014', i.width ? 'ok' : 'warn') +
            row(t('a_network'), (i.ssid ? i.ssid + ' \u00B7 ' : '') + (s && s.ip ? s.ip : '\u2014'), s && s.ip ? 'ok' : 'warn') +
            row(t('tiHub'), VERSION + (s ? ' \u00B7 ' + t('running') + ' ' + s.uptimeMin + ' ' + t('min') : ''), s ? 'ok' : 'bad') +
            row(t('a_keys'), s && s.token ? t('allowed') : t('notYet'), s && s.token ? 'ok' : 'warn');
          $('ti-rows').innerHTML = h;
        }
        function gauge(id, frac, pct, detail) {
          var g = $('ti-' + id); if (!g) { return; }
          var f = Math.max(0, Math.min(1, frac || 0)), arc = g.querySelector('.ti-arc');
          arc.setAttribute('stroke-dasharray', (f * 527.8).toFixed(1) + ' 528');
          arc.setAttribute('stroke', f >= 0.85 ? '#E8A15A' : '#EBB42C');
          g.querySelector('.ti-pc').textContent = pct;
          g.querySelector('.ti-d').textContent = detail;
        }
        function gb(b) { return (b / 1073741824).toFixed(1) + ' GB'; }
        function paintStats(s) {
          if (!s) { return; }
          if (s.storage) { var su = 1 - s.storage.free / s.storage.total; gauge('storage', su, Math.round(su * 100) + '%', fmt(t('stFree'), gb(s.storage.free)).replace('{t}', gb(s.storage.total))); }
          if (s.mem) { var mu = 1 - s.mem.avail / s.mem.total; gauge('mem', mu, Math.round(mu * 100) + '%', fmt(t('stUsed'), gb(s.mem.total - s.mem.avail)).replace('{t}', gb(s.mem.total))); }
          if (s.cpu !== null && s.cpu !== undefined) { gauge('cpu', s.cpu, Math.round(s.cpu * 100) + '%', t('tiCpuNote')); }
        }
        if (!ON_TV) {
          paintInfo({ model: 'UE55RU7172', platform: '5.0', width: 1920, height: 1080, ssid: 'Home Wi-Fi' }, { ip: '192.168.1.103', uptimeMin: 42, token: true });
          paintStats({ storage: { free: 2.4 * 1073741824, total: 4.6 * 1073741824 }, mem: { total: 2.5 * 1073741824, avail: 1.5 * 1073741824 }, cpu: 0.18 });
          return;
        }
        callService('/info', function (i) { callService('/status', function (s) { if (scr.id === 'tvinfo') { paintInfo(i.ok ? i : {}, s.ok ? s : null); } }, 4000); }, 4000);
        (function poll() {
          if (scr.id !== 'tvinfo') { return; }
          callService('/stats', function (r) { if (scr.id === 'tvinfo') { paintStats(r.ok ? r : null); setTimeout(poll, 3000); } }, 4000);
        })();
      }
    },
    update: {
      title: function (lang) { return tl(lang, 'updTitle'); },
      html: function () { return '<div class="su"><div class="up-mark"></div><div class="su-state" id="up-state"></div><div class="scr-note small">' + esc(t('updNote')) + '</div></div>'; }
    },
    setup: {
      title: function (lang) { return tl(lang, 'setupTitle'); },
      html: function () {
        return '<div class="su su2"><div class="su-qr" id="su-qr"></div><div class="su-tx">' +
          '<div class="su-k">' + esc(t('setupOpen')) + '</div><div class="su-url" id="su-url">\u2014</div>' +
          '<div class="su-k su-k2">' + esc(t('setupCode')) + '</div><div class="su-code" id="su-code">\u2022\u2022\u2022 \u2022\u2022\u2022</div>' +
          '<div class="su-state" id="su-state">' + esc(t('setupWait')) + '</div>' +
          '<div class="scr-note small">' + esc(t('setupValid')) + '</div></div></div>';
      },
      init: function () {
        scr.onBack = function () { if (ON_TV) { callService('/setup/stop', function () {}); } };
        function showLink(ip, port) {
          var link = 'http://' + ip + ':' + port;
          $('su-url').textContent = ip + ':' + port;
          if (window.qrcode) {
            try { var q = window.qrcode(0, 'M'); q.addData(link); q.make(); $('su-qr').innerHTML = q.createSvgTag({ cellSize: 9, margin: 3, scalable: true }); } catch (e) { $('su-qr').innerHTML = ''; }
          }
        }
        if (!ON_TV) { $('su-code').textContent = '482 913'; showLink('192.168.1.103', 8096); return; }
        callService('/setup/start', function (r) {
          if (!r.ok) { $('su-state').textContent = t('setupFail'); return; }
          showLink(r.ip || '?', r.port || 8096);
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


  /* ---------- Updates (About -> Install): the helper points TizenBrew to the new tag, then the page moves over ---------- */
  function checkUpdate(force, cb) {
    if (!ON_TV) {
      /* PC preview only: ?upd=0.7.0 shows the 'update available' state */
      var q = /[?&]upd=([0-9.]+)/.exec(location.search);
      updInfo = { newer: !!q, latest: q ? 'v' + q[1] : 'v' + VERSION, previous: 'v0.5.2', current: VERSION };
      updateUpdBadge(); if (cb) { cb(); } return;
    }
    callService('/update/check' + (force ? '?force=1' : ''), function (r) {
      if (r && r.current) { updInfo = r; }
      updateUpdBadge();
      if (cb) { cb(); }
    }, 20000);
  }
  function updateUpdBadge() {
    var b = $('upd-badge');
    if (updInfo && updInfo.newer) { b.hidden = false; b.textContent = fmt(t('updBadge'), updInfo.latest); }
    else { b.hidden = true; }
    var mb = $('mi-upd');
    if (mb) { mb.textContent = updInfo && updInfo.newer ? updInfo.latest : ''; }
  }
  function runUpdate(tag) {
    renderScreen('update');
    var st = $('up-state');
    if (!ON_TV) { st.textContent = 'Preview: would install ' + tag; return; }
    st.textContent = t('updWorking');
    callService('/update/apply?tag=' + encodeURIComponent(tag), function (r) {
      if (!r.ok) { st.textContent = t('updFail') + ' (' + (r.error || '?') + ')'; return; }
      var want = tag.replace(/^v/, ''), tries = 0;
      scr.timer = setInterval(function () {
        tries++;
        callService('/status', function (s) {
          if (s && s.version === want) { clearInterval(scr.timer); st.textContent = t('updDone'); setTimeout(function () { location.href = r.appPath; }, 800); }
          else if (tries >= 30) { clearInterval(scr.timer); st.textContent = t('updRestart'); }
        }, 1800);
      }, 2000);
    }, 40000);
  }

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
    if (!calData.configured) { box.hidden = true; $('idle-next').textContent = ''; $('idle-ag').innerHTML = ''; return; }
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
    var ag = upcomingToday().slice(0, 2), agH = t('today');
    if (!ag.length && next) { ag = [next]; agH = t('next').toUpperCase(); }
    $('idle-ag').innerHTML = ag.length ? '<div class="ia-k">' + esc(agH) + '</div>' + ag.map(function (e) {
      var day = e.start >= dayStart(1) ? t('daysShort')[new Date(e.start).getDay()] + ' ' : '';
      return '<div class="ia-ev">' + calDot(e) + '<span class="ia-t">' + esc(e.allDay ? t('allDay') : day + hhmm(e.start)) + '</span><span class="ia-n">' + esc(evTitle(e)) + '</span></div>';
    }).join('') : '';
  }
  /* Week strip: Monday to Sunday of the current week; today lights up; a dot marks days with meetings. */
  function renderWeek() {
    var now = new Date();
    /* Sunday: the strip starts today and runs to Saturday; Monday to Saturday: the week starts on Monday */
    var first = now.getDay() === 0 ? dayStart(0) : dayStart(-((now.getDay() + 6) % 7));
    var html = '';
    for (var i = 0; i < 7; i++) {
      var ms = dayStart(i, first);
      var d = new Date(ms);
      var isToday = ms === dayStart(0);
      var busy = calData.configured && eventsOnDay(ms).length > 0;
      var past = ms < dayStart(0);
      var weekend = d.getDay() === 0 || d.getDay() === 6;
      html += '<div class="wk' + (isToday ? ' today' : '') + (past ? ' past' : '') + (weekend ? ' we' : '') + '"><div class="wk-d">' + esc(t('daysShort')[d.getDay()]) + '</div>' +
        '<div class="wk-n">' + d.getDate() + '</div><div class="wk-dot' + (busy ? ' on' : '') + '"></div></div>';
    }
    $('week').innerHTML = html;
    /* Ričards's choice: weekend days soft blue on Sundays (strip starts Sunday), coral red Monday to Saturday */
    $('week').className = 'week' + (now.getDay() === 0 ? ' sun-start' : '');
  }

  /* ---------- Name days ---------- */
  function showNameDays() {
    var el = $('nameday');
    if (!nameDays || theme.nameDays === false) { el.textContent = ''; return; }
    var d = new Date();
    var list = nameDays[pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())] || [];
    el.textContent = list.length ? t('nameDays') + ': ' + list.join(', ') : '';
    if ($('idle-nd')) { $('idle-nd').textContent = el.textContent; }
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
  function sunCalc(date, lat, lon, alt) {
    var rad = Math.PI / 180;
    var jd = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12) / 86400000 + 2440587.5;
    var n = Math.round(jd - 2451545.0 + 0.0008);
    var js = n - lon / 360;
    var M = (357.5291 + 0.98560028 * js) % 360;
    var C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    var lam = (M + C + 180 + 102.9372) % 360;
    var jt = 2451545.0 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    var dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
    var cw = (Math.sin((alt === undefined ? -0.833 : alt) * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
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
    var G = big === 'globe';
    var id = G ? 'g' : big ? 'b' : 's';
    var padX = G ? 120 : big ? 190 : 104, base = G ? 300 : big ? 300 : 150;
    var rx = (W - padX * 2) / 2, ryDay = G ? 282 : big ? 230 : 112, ryNight = G ? 262 : big ? 100 : 44;
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
    if (!G && big) {
    s += txt(cx, base - 84, fsm, 600, '#A9BDB7', t('daylight').toUpperCase(), 'middle', ' letter-spacing="3"');
    s += '<text x="' + cx + '" y="' + (base - 26) + '" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="56" font-weight="600" fill="#F4F2EC" style="font-variant-numeric:lining-nums">' + esc(dur(today.set - today.rise)) + '</text>';
    } else if (!G) {
    /* idle: time left to sunset (or sunrise) inside the arc; the day's total length under the horizon */
    s += txt(cx, base - 60, fsm, 700, isDay ? '#EBB42C' : '#A9BDB7', (isDay ? t('sunsetIn') : t('sunriseIn')).toUpperCase(), 'middle', ' letter-spacing="3"');
    s += '<text x="' + cx + '" y="' + (base - 18) + '" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="40" font-weight="600" fill="#F4F2EC" style="font-variant-numeric:lining-nums">' + esc(dur(isDay ? today.set - now : nextRise - now)) + '</text>';
    s += txt(cx, base + 28, 18, 500, '#C9D6D2', t('daylight') + ' ' + dur(today.set - today.rise));
    }
    if (isDay) {
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 48 : 30) + '" fill="url(#sunG' + id + ')" opacity=".6"/>';
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 15 : 10) + '" fill="#F6C94E" stroke="#FFF1C2" stroke-width="2"/>';
    } else {
      s += '<circle cx="' + px + '" cy="' + py + '" r="' + (big ? 13 : 9) + '" fill="#F4F2EC" opacity=".92"/>';
      s += '<circle cx="' + (p[0] + (big ? 6 : 4)).toFixed(1) + '" cy="' + (p[1] - (big ? 4 : 3)).toFixed(1) + '" r="' + (big ? 11 : 7.5) + '" fill="#011B18"/>';
    }
    svg.innerHTML = s;
    cap.textContent = (!big && !G) ? '' : isDay ? t('sunsetIn') + ' ' + dur(today.set - now) : t('sunriseIn') + ' ' + dur(nextRise - now) + ' · ' + hhmm(nextRise);
    if (cap2) {
      cap2.textContent = !hasSecond() ? '' : isDay ? tl(prefs.lang2, 'sunsetIn') + ' ' + durL(prefs.lang2, today.set - now)
        : tl(prefs.lang2, 'sunriseIn') + ' ' + durL(prefs.lang2, nextRise - now);
    }
  }
  function renderSun() { drawSun($('sun-svg'), $('sun-cap'), null, 724, 250, false); }

  /* ---------- Weather details (hourly, summary, chart) ---------- */
  var WI = {
    wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/></svg>',
    drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    hum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 4s4 4.4 4 7.4a4 4 0 0 1-8 0C3 8.4 7 4 7 4zM17 9s4 4.4 4 7.4a4 4 0 0 1-8 0c0-3 4-7.4 4-7.4z"/></svg>',
    uv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 18h20M5 18a7 7 0 0 1 14 0M12 5v2M5 9l1.5 1.5M19 9l-1.5 1.5"/></svg>'
  };
  function localMs(s) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0; }
  /* next n hours starting with the current hour */
  function wxHours(w, n) {
    var h = w && w.hourly;
    if (!h || !h.time) { return []; }
    var now = new Date(); now.setMinutes(0, 0, 0);
    var out = [];
    for (var i = 0; i < h.time.length && out.length < n; i++) {
      var ms = localMs(h.time[i]);
      if (ms < now.getTime()) { continue; }
      out.push({ ms: ms, t: h.t[i], pp: h.pp ? h.pp[i] : 0, pr: h.pr ? h.pr[i] : 0, code: h.code[i], day: h.day ? h.day[i] : 1, wind: h.wind ? h.wind[i] : 0, gust: h.gust ? h.gust[i] : 0, dir: h.dir ? h.dir[i] : null });
    }
    return out;
  }
  function compass(deg) { return t('compass')[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
  function uvLabel(v) { return v < 3 ? t('uvLow') : v < 6 ? t('uvMod') : v < 8 ? t('uvHigh') : t('uvVHigh'); }
  /* plain-language view of the next hours */
  function wxSummary(w) {
    var out = [], hrs = wxHours(w, 15), d = w.daily;
    var rainStart = null, rainMax = 0, rainEnd = null;
    hrs.forEach(function (h) {
      if (h.pp >= 50 || h.pr >= 0.3) { if (rainStart === null) { rainStart = h.ms; } rainEnd = h.ms + 3600000; rainMax = Math.max(rainMax, h.pp); }
    });
    if (rainStart === null) { out.push(esc(t('wxDry'))); }
    else if (rainStart <= Date.now() + 1800000) { out.push(esc(fmt(t('wxRainNow'), hhmm(rainEnd))) + ' <b>' + rainMax + '%</b>'); }
    else { out.push(esc(fmt(t('wxRainFrom'), hhmm(rainStart))) + ' <b>' + rainMax + '%</b>'); }
    var gmax = 0; hrs.forEach(function (h) { gmax = Math.max(gmax, h.gust || 0); });
    if (gmax >= 12) { out.push(esc(fmt(t('wxWindy'), Math.round(gmax)))); }
    else if (gmax > 0 && gmax < 6) { out.push(esc(t('wxCalm'))); }
    if (w.feels !== undefined && Math.abs(w.feels - w.t) >= 3) { out.push(esc(fmt(t('wxFeelsLine'), Math.round(w.feels)))); }
    if (d && d.max && d.max.length > 1) {
      var diff = Math.round(d.max[1] - d.max[0]);
      out.push(esc(diff >= 2 ? fmt(t('wxWarmer'), diff) : diff <= -2 ? fmt(t('wxColder'), -diff) : t('wxSimilar')));
    }
    return out.slice(0, 4);
  }
  /* 24 h: temperature line, rain bars, icons every 3 h */
  function drawWxChart(svg, hrs) {
    if (!svg || !hrs.length) { return; }
    var W = 1728, H = 240, top = 40, bot = 128, n = hrs.length, step = W / n;
    var tmin = Infinity, tmax = -Infinity;
    hrs.forEach(function (h) { tmin = Math.min(tmin, h.t); tmax = Math.max(tmax, h.t); });
    if (tmax - tmin < 4) { var m = (tmax + tmin) / 2; tmin = m - 2; tmax = m + 2; }
    function y(v) { return bot - 18 - (v - tmin) / (tmax - tmin) * (bot - top - 44); }
    var s = '<defs><linearGradient id="wxT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#EBB42C" stop-opacity=".22"/><stop offset="100%" stop-color="#EBB42C" stop-opacity="0"/></linearGradient></defs>';
    /* rain bars */
    hrs.forEach(function (h, i) {
      if (h.pp > 0) { var bh = h.pp / 100 * 70; s += '<rect x="' + (i * step + step * 0.22).toFixed(1) + '" y="' + (bot - bh).toFixed(1) + '" width="' + (step * 0.56).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="#7FB3C9" fill-opacity="' + (0.25 + h.pp / 160).toFixed(2) + '"/>'; }
    });
    var pts = hrs.map(function (h, i) { return [(i + 0.5) * step, y(h.t)]; });
    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    s += '<path d="' + line + ' L' + pts[n - 1][0].toFixed(1) + ' ' + bot + ' L' + pts[0][0].toFixed(1) + ' ' + bot + ' Z" fill="url(#wxT)"/>';
    s += '<path d="' + line + '" fill="none" stroke="#EBB42C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
    s += '<line x1="0" y1="' + bot + '" x2="' + W + '" y2="' + bot + '" stroke="#A9BDB7" stroke-opacity=".3"/>';
    hrs.forEach(function (h, i) {
      var x = (i + 0.5) * step;
      if (i % 3 === 0) {
        s += '<circle cx="' + x.toFixed(1) + '" cy="' + pts[i][1].toFixed(1) + '" r="5" fill="#012B28" stroke="#EBB42C" stroke-width="2.5"/>';
        s += '<text x="' + x.toFixed(1) + '" y="' + (pts[i][1] - 14).toFixed(1) + '" text-anchor="middle" font-family="Manrope, Arial" font-size="22" font-weight="700" fill="#F4F2EC">' + Math.round(h.t) + '°</text>';
        s += '<text x="' + x.toFixed(1) + '" y="' + (bot + 32) + '" text-anchor="middle" font-family="Manrope, Arial" font-size="20" font-weight="700" fill="#A9BDB7">' + (i === 0 ? esc(t('now')) : pad2(new Date(h.ms).getHours()) + ':00') + '</text>';
        /* wind: arrow points where the wind blows to; amber when gusts are strong */
        var strong = (h.gust || 0) >= 12, wc = strong ? '#E8A15A' : '#DCE5E1';
        var ws = Math.round(h.wind || 0) + ' m/s';
        var hasDir = h.dir !== null && h.dir !== undefined;
        var gw = ws.length * 10 + (hasDir ? 22 : 0), gx = Math.max(4, Math.min(W - gw - 4, x - gw / 2));
        if (hasDir) {
          s += '<g transform="translate(' + (gx + 8).toFixed(1) + ' ' + (bot + 61) + ') rotate(' + Math.round(h.dir + 180) + ')"><path d="M0 -8 L5.5 6 L0 3 L-5.5 6 Z" fill="' + wc + '"/></g>';
        }
        s += '<text x="' + (gx + (hasDir ? 22 : 0)).toFixed(1) + '" y="' + (bot + 67) + '" text-anchor="start" font-family="Manrope, Arial" font-size="19" font-weight="500" fill="' + wc + '">' + ws + '</text>';
        if (h.pp >= 30) { s += '<text x="' + x.toFixed(1) + '" y="' + (bot + 98) + '" text-anchor="middle" font-family="Manrope, Arial" font-size="18" font-weight="700" fill="#7FB3C9">' + h.pp + '%</text>'; }
      }
    });
    svg.innerHTML = s;
  }
  /* idle: next 5 hours */
  function renderIdleHours() {
    var box = $('idle-hours');
    if (!box) { return; }
    var w = store('weather');
    /* every 2 hours: now +2, +4, +6, +8, +10 */
    var all = wxHours(w, 11), hrs = [];
    for (var i = 2; i < all.length && hrs.length < 5; i += 2) { hrs.push(all[i]); }
    $('idle-hk').textContent = hrs.length ? t('idleHours') : '';
    box.innerHTML = hrs.map(function (h) {
      var pp = Math.max(0, Math.min(100, Math.round(h.pp || 0)));
      return '<div class="ih"><div class="ih-h">' + pad2(new Date(h.ms).getHours()) + ':00</div><div class="ih-ic">' + wxIcon(h.code, h.day) + '</div>' +
        '<div class="ih-t">' + Math.round(h.t) + '°</div>' +
        '<div class="ih-bar"><i style="width:' + pp + '%"></i></div><div class="ih-p' + (pp < 20 ? ' low' : '') + '">' + pp + '%</div></div>';
    }).join('');
    var now = $('idle-now');
    if (!w) { now.innerHTML = ''; return; }
    var line1 = wmo(w.code) + (w.feels !== undefined ? ' · ' + fmt(t('wxFeels'), Math.round(w.feels)) : '');
    var line2 = wxSummary(w)[0] || '';
    now.innerHTML = '<span class="in-ic">' + wxIcon(w.code, w.day) + '</span><span class="in-t">' + Math.round(w.t) + '°</span>' +
      '<span class="in-tx"><span class="in-1">' + esc(line1) + '</span><span class="in-2">' + line2 + '</span></span>';
  }
  /* ---------- Daylight details: twilight, golden hour, moon, year curve ---------- */
  function sunAt(dayOffset, alt) {
    var cfg = theme.weather || {};
    return sunCalc(new Date(dayStart(dayOffset)), +cfg.latitude || 56.95, +cfg.longitude || 24.11, alt);
  }
  function paintSunFacts(box) {
    if (!box) { return; }
    var s = sunFor(0), civ = sunAt(0, -6), gold = sunAt(0, 6), y = sunFor(-1);
    function row(k, v, cls) { return '<div class="sf' + (cls ? ' ' + cls : '') + '"><span class="sf-k">' + esc(t(k)) + '</span><span class="sf-v">' + v + '</span></div>'; }
    var calc = sunAt(0, -0.833);
    if (s.polar) { box.innerHTML = '<div class="dl-h">' + esc(t('dlSun')) + '</div>' + row('daylight', esc(s.polar === 'day' ? t('polarDay') : t('polarNight'))); return; }
    var len = s.set - s.rise, diff = (y.rise && y.set) ? Math.round((len - (y.set - y.rise)) / 60000) : 0;
    var noon = (s.rise + s.set) / 2;
    box.innerHTML = '<div class="dl-h">' + esc(t('dlSun')) + '</div>' +
      row('dlDawn', civ.rise ? hhmm(civ.rise) : '–') +
      row('sunrise', hhmm(s.rise), 'hi') +
      row('dlGoldAm', gold.rise && calc.rise ? hhmm(calc.rise) + '–' + hhmm(gold.rise) : '–') +
      row('dlNoon', hhmm(noon)) +
      row('dlGoldPm', gold.set && calc.set ? hhmm(gold.set) + '–' + hhmm(calc.set) : '–') +
      row('sunset', hhmm(s.set), 'hi') +
      row('dlDusk', civ.set ? hhmm(civ.set) : '–') +
      '<div class="sf-len"><div class="sf-len-v">' + esc(dur(len)) + '</div><div class="sf-len-d">' + esc(fmt(diff >= 0 ? t('dlLonger') : t('dlShorter'), Math.abs(diff))) + '</div></div>';
  }
  function moonInfo(ms) {
    var syn = 29.530588, age = (((ms / 86400000 - 10962.76) % syn) + syn) % syn;
    var frac = age / syn, illum = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
    var idx = Math.floor((frac * 8) + 0.5) % 8;
    return { age: age, frac: frac, illum: illum, idx: idx,
      nextFull: ms + (((syn / 2 - age) % syn) + syn) % syn * 86400000, nextNew: ms + (syn - age) * 86400000 };
  }
  function shortDate(ms) { var d = new Date(ms); return t('daysShort')[d.getDay()] + ' ' + d.getDate() + '. ' + t('monthsShort')[d.getMonth()]; }
  function paintMoon(box) {
    if (!box) { return; }
    var m = moonInfo(Date.now());
    box.innerHTML = '<div class="dl-h">' + esc(t('dlMoon')) + '</div>' +
      '<svg class="moon-big" viewBox="0 0 100 100" width="200" height="200"><defs><radialGradient id="mbLit" cx="42%" cy="38%" r="70%"><stop offset="0%" stop-color="#FFF9E6"/><stop offset="70%" stop-color="#EFD9A0"/><stop offset="100%" stop-color="#C9A55A"/></radialGradient></defs>' +
      '<circle cx="50" cy="50" r="32" fill="#0B3A35" stroke="#A9BDB7" stroke-opacity=".35"/><path d="' + moonPath(m.frac) + '" fill="url(#mbLit)"/></svg>' +
      '<div class="moon-name">' + esc(t('moonPhases')[m.idx]) + '</div>' +
      '<div class="sf"><span class="sf-k">' + esc(t('moonLit')) + '</span><span class="sf-v">' + m.illum + '%</span></div>' +
      '<div class="sf"><span class="sf-k">' + esc(t('moonAge')) + '</span><span class="sf-v">' + Math.floor(m.age) + ' ' + esc(t('daysWord')) + '</span></div>' +
      '<div class="sf"><span class="sf-k">' + esc(t('moonFull')) + '</span><span class="sf-v">' + esc(shortDate(m.nextFull)) + '</span></div>' +
      '<div class="sf"><span class="sf-k">' + esc(t('moonNew')) + '</span><span class="sf-v">' + esc(shortDate(m.nextNew)) + '</span></div>';
  }
  /* day length through the year with today, shortest and longest day */
  function paintYear(svg) {
    if (!svg) { return; }
    var cfg = theme.weather || {}, lat = +cfg.latitude || 56.95, lon = +cfg.longitude || 24.11;
    var yr = new Date().getFullYear(), W = 1728, H = 120, pts = [], lens = [];
    for (var d = 0; d < 366; d += 3) {
      var dt = new Date(yr, 0, 1 + d), s = sunCalc(dt, lat, lon);
      lens.push(s.polar === 'day' ? 24 : s.polar === 'night' ? 0 : (s.set - s.rise) / 3600000);
    }
    var mx = Math.max.apply(null, lens), mn = Math.min.apply(null, lens);
    lens.forEach(function (v, i) { pts.push([i / (lens.length - 1) * W, 96 - (v - mn) / Math.max(0.1, mx - mn) * 76]); });
    var path = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    var doy = (dayStart(0) - new Date(yr, 0, 1).getTime()) / 86400000, tx = doy / 365 * W;
    var ti = Math.min(lens.length - 1, Math.round(doy / 3)), ty = pts[ti][1];
    var s2 = '<defs><linearGradient id="yrF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#EBB42C" stop-opacity=".18"/><stop offset="100%" stop-color="#EBB42C" stop-opacity="0"/></linearGradient></defs>';
    s2 += '<path d="' + path + ' L' + W + ' 104 L0 104 Z" fill="url(#yrF)"/><path d="' + path + '" fill="none" stroke="#A9BDB7" stroke-opacity=".7" stroke-width="2.5"/>';
    for (var mth = 0; mth < 12; mth++) {
      var x = (new Date(yr, mth, 1).getTime() - new Date(yr, 0, 1).getTime()) / 86400000 / 365 * W;
      s2 += '<text x="' + (x + 6).toFixed(0) + '" y="118" font-family="Manrope, Arial" font-size="16" fill="#A9BDB7" fill-opacity=".8">' + esc(t('monthsShort')[mth]) + '</text>';
    }
    s2 += '<text x="' + (W - 4) + '" y="18" text-anchor="end" font-family="Manrope, Arial" font-size="17" fill="#A9BDB7">' + esc(fmt(t('dlLongest'), Math.round(mx * 10) / 10)) + ' · ' + esc(fmt(t('dlShortest'), Math.round(mn * 10) / 10)) + '</text>';
    s2 += '<line x1="' + tx.toFixed(1) + '" y1="10" x2="' + tx.toFixed(1) + '" y2="104" stroke="#EBB42C" stroke-opacity=".5" stroke-dasharray="3 5"/>';
    s2 += '<circle cx="' + tx.toFixed(1) + '" cy="' + ty.toFixed(1) + '" r="8" fill="#EBB42C"/>';
    svg.innerHTML = s2;
  }

  /* ---------- Globe: orthographic Earth from a 1024x512 land map, lookup tables, array copy per frame ---------- */
  var globe = { on: false, cv: null, ctx: null, img: null, mask: null, px: null, base: null, limb: null, pal: null, light: null, lightAt: 0, off: 0, lastOff: -1, step: 100, frames: 0, cost: 0, timer: 0 };
  var GW = 1024, GH = 512, TILT = 22 * Math.PI / 180, GLOBE_TURN_S = 240;  /* one slow turn every 4 minutes */
  function globeLoadMask(cb) {
    if (globe.mask) { cb(); return; }
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas'); c.width = GW; c.height = GH;
      var x = c.getContext('2d'); x.drawImage(im, 0, 0);
      var d = x.getImageData(0, 0, GW, GH).data, m = new Uint8Array(GW * GH);
      for (var i = 0; i < m.length; i++) { m[i] = d[i * 4] > 127 ? 1 : 0; }
      globe.mask = m; cb();
    };
    im.onerror = function () { cb('mask'); };
    im.src = 'img/land-1024.png?v=' + VERSION;
  }
  /* Per-pixel tables: which texel each screen pixel shows, and how far it is from the limb (depth shading). */
  function globeTables(S) {
    var R = S / 2 - 1, px = [], base = [], limb = [];
    var sp = Math.sin(TILT), cp = Math.cos(TILT);
    for (var yy = 0; yy < S; yy++) {
      for (var xx = 0; xx < S; xx++) {
        var u = (xx + 0.5 - S / 2) / R, v = (S / 2 - yy - 0.5) / R, r2 = u * u + v * v;
        if (r2 > 1) { continue; }
        var z = Math.sqrt(1 - r2);
        var yw = v * cp + z * sp, zw = -v * sp + z * cp;
        var lat = Math.asin(Math.max(-1, Math.min(1, yw))), lon = Math.atan2(u, zw);
        var row = Math.min(GH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * GH)));
        var col = Math.floor((lon / (2 * Math.PI) + 0.5) * GW) & (GW - 1);
        px.push(yy * S + xx); base.push(row * GW + col); limb.push(Math.min(31, Math.round(Math.pow(z, 0.55) * 31)));
      }
    }
    globe.px = new Uint32Array(px); globe.base = new Uint32Array(base); globe.limb = new Uint8Array(limb);
    /* palette [land 2][daylight 32][depth 32]: night -> twilight (a touch of Greenwood gold) -> day */
    function mix(a, b, f) { return a + (b - a) * f; }
    var pal = new Uint32Array(2048);
    var OD = [22, 96, 86], ON = [2, 21, 20], LD = [218, 226, 212], LN = [30, 52, 48], G = [235, 180, 44];
    for (var land = 0; land < 2; land++) {
      for (var dq = 0; dq < 32; dq++) {
        var d = dq / 31, tw = 4 * d * (1 - d) * (land ? 0.22 : 0.30);
        for (var lq = 0; lq < 32; lq++) {
          var lz = 0.5 + 0.5 * (lq / 31), c = [];
          for (var k = 0; k < 3; k++) {
            var day = land ? LD[k] : OD[k], night = land ? LN[k] : ON[k];
            var v0 = mix(night, day, d) * mix(0.62, 1, lz);
            c.push(Math.max(0, Math.min(255, Math.round(mix(v0, G[k], tw)))));
          }
          pal[(land << 10) | (dq << 5) | lq] = (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
        }
      }
    }
    globe.pal = pal;
  }
  /* Where the sun is overhead right now (declination + longitude), from the date alone. */
  function subsolar(ms) {
    var d = ms / 86400000 - 10957.5, rad = Math.PI / 180;
    var g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (280.46061837 + 360.98564736629 * d) % 360;
    var lon = (ra / rad - gmst) % 360; if (lon > 180) { lon -= 360; } if (lon < -180) { lon += 360; }
    return { dec: dec, lon: lon * rad };
  }
  /* Daylight map in Earth coordinates (32 levels with a soft twilight band), refreshed every minute. */
  function globeLight(ms) {
    var s = subsolar(ms), sd = Math.sin(s.dec), cd = Math.cos(s.dec);
    var light = globe.light || new Uint8Array(GW * GH), cosd = new Float32Array(GW);
    for (var c = 0; c < GW; c++) { cosd[c] = Math.cos(((c + 0.5) / GW * 2 - 1) * Math.PI - s.lon); }
    for (var r = 0; r < GH; r++) {
      var lat = (0.5 - (r + 0.5) / GH) * Math.PI, a = Math.sin(lat) * sd, b = Math.cos(lat) * cd, o = r * GW;
      for (var c2 = 0; c2 < GW; c2++) {
        var cz = a + b * cosd[c2], f = (cz + 0.11) / 0.22;  /* sun from about 6 degrees below to 6 above the horizon */
        f = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
        /* the day side is brightest under the sun and softens toward the evening and morning edge */
        if (cz > 0) { f *= 0.74 + 0.26 * Math.sqrt(cz); }
        light[o + c2] = Math.round(f * 31);
      }
    }
    globe.light = light; globe.lightAt = ms; globe.lastOff = -1;
  }
  function globeFrame() {
    if (!globe.on) { return; }
    var t0 = Date.now();
    if (t0 - globe.lightAt > 60000) { globeLight(t0); }
    var off = Math.floor(globe.off) & (GW - 1);
    if (off !== globe.lastOff) {
      var S = globe.cv.width, data32 = globe.data32, m = globe.mask, lt = globe.light, pal = globe.pal, px = globe.px, base = globe.base, lb = globe.limb;
      for (var i = 0; i < px.length; i++) {
        var b = base[i], t = (b & ~1023) | (((b & 1023) - off) & 1023);
        data32[px[i]] = pal[(m[t] << 10) | (lt[t] << 5) | lb[i]];
      }
      globe.ctx.putImageData(globe.img, 0, 0);
      /* Rīga marker */
      var cfg = theme.weather || {}, la = (+cfg.latitude || 56.95) * Math.PI / 180;
      var lo = (+cfg.longitude || 24.11) * Math.PI / 180 + off / GW * 2 * Math.PI;
      var x = Math.cos(la) * Math.sin(lo), yw = Math.sin(la), zw = Math.cos(la) * Math.cos(lo);
      var v = yw * Math.cos(TILT) - zw * Math.sin(TILT), z = yw * Math.sin(TILT) + zw * Math.cos(TILT);
      if (z > 0.05) {
        var R = S / 2 - 1, cx = S / 2 + x * R, cy = S / 2 - v * R, c = globe.ctx;
        c.beginPath(); c.arc(cx, cy, 12, 0, 2 * Math.PI); c.fillStyle = 'rgba(235,180,44,0.22)'; c.fill();
        c.beginPath(); c.arc(cx, cy, 5, 0, 2 * Math.PI); c.fillStyle = '#EBB42C'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = 'rgba(1,43,40,0.9)'; c.stroke();
      }
      globe.lastOff = off;
      globe.frames++; globe.cost += Date.now() - t0;
      if (globe.frames === 12) {
        var avg = globe.cost / 12;
        globe.step = avg > 150 ? 0 : avg > 60 ? 400 : 200;  /* slow TVs redraw less often, very slow ones keep a still image */
      }
    }
    globe.off = (globe.off + GW / GLOBE_TURN_S * (globe.step || 200) / 1000) % GW;
    if (globe.step) { globe.timer = setTimeout(globeFrame, globe.step); }
  }
  function globeStart(cv) {
    globeStop();
    if (!cv || !cv.getContext) { return; }
    globe.cv = cv; globe.ctx = cv.getContext('2d');
    globeLoadMask(function (err) {
      if (err || !globe.ctx) { return; }
      if (!globe.px || globe.size !== cv.width) { globeTables(cv.width); globe.size = cv.width; }
      globe.img = globe.ctx.createImageData(cv.width, cv.width);
      globe.data32 = new Uint32Array(globe.img.data.buffer);
      globe.on = true; globe.frames = 0; globe.cost = 0; globe.step = 200; globe.lightAt = 0; globe.lastOff = -1;
      /* start with Rīga facing the viewer */
      var cfg = theme.weather || {};
      globe.off = -((+cfg.longitude || 24.11) / 360 * GW) + GW;
      globeFrame();
    });
  }
  function globeStop() { globe.on = false; clearTimeout(globe.timer); }
  /* ---------- Quick play radio: plays inside the hub, home stays on screen ---------- */
  var radio = { list: [], groups: [], cur: null, audio: null, state: 'off', routes: [], idx: 0, att: 0, retry: 0, timer: 0, wait: 0, why: [], last: null, played: false, drops: 0, good: 0, pos: 0, posAt: 0, ticks: 0, drops2: [], stage: 0, dataAt: 0, t0: 0, tPlay: 0 };
  function radioLoad() {
    getJSON('radio.json?v=' + VERSION, function (err, d) {
      if (err || !d || !d.groups) { return; }
      radio.groups = d.groups;
      radio.list = [];
      d.groups.forEach(function (g) { g.stations.forEach(function (s) { s.group = g.id; radio.list.push(s); }); });
      var saved = store('radio');
      radio.cur = radio.list.filter(function (s) { return saved && s.id === saved.id; })[0] || radio.list[0];
      renderRadio();
    });
  }
  /* Quick play player.
     Starting: each address is tried directly and through the hub helper (which copes with old Shoutcast servers,
     redirects and certificates newer than the TV's own list). https addresses go through the helper first on the
     TV, plain http ones directly first. An attempt that has not started playing within 12 s counts as failed,
     exactly once. If nothing plays after two rounds the station is reported as not reachable.
     Staying on: once a station has played, a drop never turns it off. The stream ending, an error, a stall
     longer than 12 s or 20 s without progress all reconnect, starting from the address that last worked,
     waiting 2, 4, 8, 15, 30 then every 60 s, until it plays again or it is switched off.
     The last result shows on About.
     0.7.6: this TV's own (Samsung) player can take longer than 12 s to start a live stream. An address that is
     first gets 20 s, and one that is still moving forward (data in the buffer growing, header read, ready) gets up
     to 45 s. The player sits in the page, loads eagerly and is nudged to play once it is ready.
     A failure says how far it got and what the helper received, so the next fix never has to be a guess. */
  var RADIO_TIMEOUT = 12000, RADIO_START = 20000, RADIO_MAX = 45000, RADIO_BACKOFF = [2000, 4000, 8000, 15000, 30000, 60000];
  var RADIO_STAGE = ['no answer', 'connected', 'data', 'header', 'ready'];
  function radioRoutes(st) {
    var out = [];
    function add(u) {
      var hls = /\.m3u8(\?|$)/i.test(u), sec = /^https:/i.test(u);
      if (ON_TV && hls) { return; }
      var d = { src: u, via: 'direct', url: u }, h = { src: SERVICE + '/radio?u=' + encodeURIComponent(u), via: 'helper', url: u };
      if (!ON_TV) { out.push(d); return; }
      if (sec) { out.push(h, d); } else { out.push(d, h); }
    }
    st.urls.forEach(add);
    /* an https address on the standard port is often also served over plain http: try that last */
    st.urls.forEach(function (u) {
      var m = /^https:\/\/([^\/:]+)(\/.*)?$/i.exec(u);
      if (ON_TV && m && !/\.m3u8(\?|$)/i.test(u)) {
        var hu = 'http://' + m[1] + (m[2] || '/');
        if (st.urls.indexOf(hu) < 0) { add(hu); }
      }
    });
    return out;
  }
  function radioNote(result) {
    radio.last = { name: radio.cur ? radio.cur.name : '', result: result, at: Date.now() };
    store('radioLast', radio.last);
  }
  function radioEl() {
    if (!radio.audio) {
      var a = document.createElement('audio');
      a.preload = 'auto';
      a.setAttribute('aria-hidden', 'true');
      a.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(a);
      var up = function (n) {
        if (radio.state === 'off') { return; }
        if (n === 2) { radio.dataAt = Date.now(); }
        if (n > radio.stage) { radio.stage = n; }
        /* ready but not started by itself: ask once more */
        if (n === 4 && a.paused) { try { var pp = a.play(); if (pp && pp.catch) { pp.catch(function () { /* the timer decides */ }); } } catch (e) { /* the timer decides */ } }
      };
      a.addEventListener('loadstart', function () { up(1); });
      a.addEventListener('progress', function () { up(2); });
      a.addEventListener('loadedmetadata', function () { up(3); });
      a.addEventListener('canplay', function () { up(4); });
      a.addEventListener('playing', function () {
        if (radio.state === 'off') { return; }
        clearTimeout(radio.timer);
        var r = radio.routes[radio.idx], again = radio.played;
        radio.state = 'playing'; radio.retry = 0; radio.drops = 0; radio.played = true; radio.good = radio.idx;
        radio.pos = a.currentTime; radio.posAt = Date.now(); radio.ticks = 0;
        renderRadio();
        var n = (radio.drops2 || []).filter(function (x) { return Date.now() - x < 3600000; }).length;
        radioNote((again ? 'playing again' : 'playing') + (r && r.via === 'helper' ? ' via helper' : '') + (n ? ' \u00B7 ' + n + ' reconnect' + (n > 1 ? 's' : '') + ' in the last hour (last: ' + (radio.why[radio.why.length - 1] || '?') + ')' : ''));
      });
      a.addEventListener('timeupdate', function () {
        if (a.currentTime === radio.pos) { return; }
        radio.pos = a.currentTime; radio.posAt = Date.now(); radio.ticks++;
        /* sound is moving again after a hiccup: carry on, nothing to reconnect */
        if (radio.state === 'loading' && radio.played) { clearTimeout(radio.timer); radio.state = 'playing'; renderRadio(); }
      });
      /* 'stalled' only means no new data for ~3 s and often fires while sound keeps playing from the buffer, so it
         never interrupts anything. 'waiting' (the buffer really ran out) gets 12 s to recover by itself. */
      a.addEventListener('waiting', function () { if (radio.state === 'playing') { radio.state = 'loading'; renderRadio(); radioArm(); } });
      a.addEventListener('ended', function () { radioFail(radio.att, 'stream ended'); });
      a.addEventListener('error', function () { if (a.getAttribute('src')) { radioFail(radio.att, 'error ' + (a.error ? a.error.code : '?')); } });
      radio.audio = a;
    }
    return radio.audio;
  }
  function radioArm(from0) {
    var att = radio.att;
    clearTimeout(radio.timer);
    var from = Date.now(), first = from0 || from, st0 = radio.stage, buf0 = radioBuffered();
    radio.timer = setTimeout(function () {
      if (att !== radio.att || radio.state === 'off') { return; }
      if (radio.played && radio.posAt > from) { if (radio.state === 'loading') { radio.state = 'playing'; renderRadio(); } return; }
      /* still moving forward: give it more time, up to RADIO_MAX for this address */
      var buf = radioBuffered();
      if (buf > buf0 && radio.stage < 2) { radio.stage = 2; }
      if ((radio.dataAt > from || radio.stage > st0 || buf > buf0) && Date.now() - first < RADIO_MAX) {
        if (radio.stage >= 4 && radio.audio && radio.audio.paused) { try { var pp = radio.audio.play(); if (pp && pp.catch) { pp.catch(function () { /* timer decides */ }); } } catch (e) { /* timer decides */ } }
        radioArm(first);
        return;
      }
      radioFail(att, 'timeout (' + RADIO_STAGE[radio.stage] + ')');
    }, radio.played || from0 ? RADIO_TIMEOUT : RADIO_START);
  }
  /* seconds of audio the player holds; grows while data arrives even when no 'progress' event fires */
  function radioBuffered() {
    try { var b = radio.audio && radio.audio.buffered; return b && b.length ? b.end(b.length - 1) : 0; } catch (e) { return 0; }
  }
  /* watchdog: playing but the clock has not moved for 20 s = silently stuck */
  setInterval(function () {
    if (radio.state === 'playing' && radio.audio && radio.ticks > 3 && !radio.audio.paused && Date.now() - (radio.posAt || Date.now()) > 20000) { radioFail(radio.att, 'no sound for 20 s'); }
  }, 5000);
  function radioPlay(st) {
    if (st) { radio.cur = st; store('radio', { id: st.id }); }
    if (!radio.cur) { return; }
    clearTimeout(radio.wait);
    radio.routes = radioRoutes(radio.cur); radio.idx = 0; radio.retry = 0; radio.why = [];
    radio.played = false; radio.drops = 0; radio.good = 0; radio.drops2 = []; radio.ticks = 0; radio.tPlay = Date.now();
    radio.state = 'loading'; renderRadio();
    radioStart();
  }
  function radioStart() {
    var a = radioEl(), r = radio.routes[radio.idx];
    if (!r) { radioFail(radio.att, 'no address'); return; }
    radio.att = (radio.att || 0) + 1;
    var att = radio.att;
    radio.stage = 0; radio.dataAt = 0; radio.t0 = Date.now();
    radioArm();
    try {
      a.src = r.src;
      a.load();
      var p = a.play();
      if (p && p.catch) { p.catch(function (e) { radioFail(att, 'play ' + (e && e.name ? e.name : 'refused')); }); }
    } catch (e) { radioFail(att, 'play error'); }
  }
  function radioFail(att, why) {
    if (radio.state === 'off' || att !== radio.att) { return; }   /* already handled, or an old attempt */
    radio.att++;
    clearTimeout(radio.timer);
    var r = radio.routes[radio.idx];
    radio.why.push((r ? r.via + ' ' : '') + why);
    if (radio.why.length > 8) { radio.why.shift(); }
    if (radio.played) {
      /* it worked before: keep it on and reconnect, starting with the address that last worked */
      var first = radio.state === 'playing';
      if (!first && radio.idx + 1 < radio.routes.length) { radio.idx++; radioStart(); return; }
      var delay = RADIO_BACKOFF[Math.min(radio.drops, RADIO_BACKOFF.length - 1)];
      radio.drops++;
      radio.idx = radio.good || 0;
      radio.state = 'retry'; renderRadio();
      try { radio.audio.pause(); } catch (e) { /* ignore */ }
      radio.drops2 = (radio.drops2 || []).filter(function (x) { return Date.now() - x < 3600000; }); radio.drops2.push(Date.now());
      radioNote('reconnecting: ' + why);
      clearTimeout(radio.wait);
      radio.wait = setTimeout(function () { if (radio.state === 'retry') { radioStart(); } }, first ? 300 : delay);
      return;
    }
    if (radio.idx + 1 < radio.routes.length) { radio.idx++; radioStart(); return; }
    if (radio.retry < 1 && Date.now() - radio.tPlay < 60000) { radio.retry++; radio.idx = 0; clearTimeout(radio.wait); radio.wait = setTimeout(function () { if (radio.state !== 'off') { radioStart(); } }, 1500); return; }
    var whys = radio.why.filter(function (w, i, l) { return l.indexOf(w) === i; }).slice(-4).join(', '), since = radio.tPlay;
    radioNote('failed: ' + whys);
    radioStopAudio(); radio.state = 'off'; renderRadio(); toast(fmt(t('radioFail'), radio.cur.name));
    /* add what the helper actually received, so About tells "no data reached the TV" from "data came, player would not start" */
    if (ON_TV) {
      var nm = radio.cur.name;
      callService('/radio/seen', function (s) {
        var list = (s && s.seen || []).filter(function (e) { return e.at >= since - 1000; });
        if (!list.length) { return; }
        var e = list[list.length - 1];
        var kb = Math.round((e.bytes || 0) / 1024);
        var ln = 'helper got ' + kb + ' KB' + (e.code && e.code !== 200 ? ' (answer ' + e.code + ')' : '') + (e.end ? ', ' + e.end : '');
        if (radio.state === 'off' && radio.last && radio.last.name === nm) { radioNote('failed: ' + ln + ' \u00B7 ' + whys); }
      }, 3000);
    }
  }
  function radioStopAudio() {
    clearTimeout(radio.timer); clearTimeout(radio.wait);
    if (radio.audio) { try { radio.audio.pause(); radio.audio.removeAttribute('src'); radio.audio.load(); } catch (e) { /* ignore */ } }
  }
  function radioStop() {
    radio.state = 'off'; radio.att = (radio.att || 0) + 1;
    radioStopAudio();
    renderRadio();
  }
  function radioToggle() { if (radio.state === 'off') { radioPlay(); } else { radioStop(); } }
  /* Sound test (About): a 2-second chime stored in the hub itself, played the same way as a station.
     Heard = the TV's player works and any radio problem is in the streams; silent = the player itself. */
  function soundTest(done) {
    radioStop();
    var a = document.createElement('audio'), fin = false, stage = 0, went = false, tm = 0;
    a.preload = 'auto';
    a.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(a);
    function end(ok, why) {
      if (fin) { return; }
      fin = true; clearTimeout(tm);
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { /* ignore */ }
      if (a.parentNode) { a.parentNode.removeChild(a); }
      var r = { ok: ok, result: ok ? 'played' : why, at: Date.now() };
      store('soundTest', r);
      toast(ok ? t('soundOk') : fmt(t('soundFail'), why));
      if (done) { done(r); }
    }
    a.addEventListener('loadstart', function () { stage = Math.max(stage, 1); });
    a.addEventListener('progress', function () { stage = Math.max(stage, 2); });
    a.addEventListener('loadedmetadata', function () { stage = Math.max(stage, 3); });
    a.addEventListener('canplay', function () { stage = Math.max(stage, 4); });
    a.addEventListener('playing', function () { went = true; });
    a.addEventListener('timeupdate', function () { if (a.currentTime > 0.5) { went = true; } });
    a.addEventListener('ended', function () { end(true); });
    a.addEventListener('error', function () { end(false, 'error ' + (a.error ? a.error.code : '?')); });
    tm = setTimeout(function () { end(went, went ? '' : 'timeout (' + RADIO_STAGE[stage] + ')'); }, 15000);
    try {
      a.src = 'sound-test.mp3?v=' + VERSION;
      a.load();
      var p = a.play();
      if (p && p.catch) { p.catch(function (e) { end(false, 'play ' + (e && e.name ? e.name : 'refused')); }); }
    } catch (e) { end(false, 'play error'); }
  }
  function renderRadio() {
    var box = $('qp');
    if (!box) { return; }
    var on = radio.state !== 'off';
    box.className = 'qp' + (on ? ' on' : '') + (radio.state === 'loading' || radio.state === 'retry' ? ' loading' : '');
    var nm = radio.cur ? radio.cur.name : '';
    var tog = $('qp-toggle');
    if (tog) {
      tog.querySelector('.qp-ic').innerHTML = on ? ICONS.pause : ICONS.play;
      tog.querySelector('.qp-nm').textContent = nm;
      tog.querySelector('.qp-st').textContent = radio.state === 'retry' ? t('radioRetry') : radio.state === 'loading' ? t('radioLoading') : on ? t('radioOn') : t('radioOff');
    }
    var ii = $('idle-radio');
    if (ii) { ii.textContent = on ? '♪ ' + nm : ''; }
  }

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
    if (mode === 'card') {
      /* no Wi-Fi password on the TV yet: OK opens the phone setup screen */
      if (k === KEY.ENTER && wifiNeedsSetup) { mode = 'home'; $('card').hidden = true; openScreen('setup'); return; }
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE || k === KEY.ENTER) { closeCard(); } return;
    }
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
    if (h !== lastHour) { lastHour = h; var age = (((d.getTime() / 86400000 - 10962.76) % 29.530588) + 29.530588) % 29.530588; $('moon-path').setAttribute('d', moonPath(age / 29.530588)); updateGreeting(h); renderIdleHours(); }
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
    renderIdleHours();
  }
  function weather(force) {
    var cfg = theme.weather || {};
    clearTimeout(weatherTimer);
    if (!cfg.enabled) { $('weather').textContent = ''; return; }
    var maxAge = (cfg.cacheMinutes || 30) * 60000;
    var cached = store('weather');
    if (!force && cached && cached.hourly && Date.now() - cached.at < maxAge) {
      showWeather(cached, false);
      weatherTimer = setTimeout(weather, maxAge - (Date.now() - cached.at) + 1000);
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.latitude + '&longitude=' + cfg.longitude +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,uv_index_max' +
      '&wind_speed_unit=ms&forecast_days=7&timezone=auto';
    getJSON(url, function (err, data) {
      if (!err && data && data.current) {
        var dl = data.daily || {}, c = data.current, hr = data.hourly || {};
        /* keep the hours from now on (about 2 days) to stay small in storage */
        var start = 0, nowH = new Date(); nowH.setMinutes(0, 0, 0);
        if (hr.time) { while (start < hr.time.length && localMs(hr.time[start]) < nowH.getTime()) { start++; } }
        function cut(a) { return a ? a.slice(start, start + 48) : null; }
        var w = { t: c.temperature_2m, code: c.weather_code, day: c.is_day, at: Date.now(), feels: c.apparent_temperature, hum: c.relative_humidity_2m,
          wind: c.wind_speed_10m, dir: c.wind_direction_10m, gust: c.wind_gusts_10m, pres: c.surface_pressure,
          hourly: hr.time ? { time: cut(hr.time), t: cut(hr.temperature_2m), pp: cut(hr.precipitation_probability), pr: cut(hr.precipitation), code: cut(hr.weather_code), day: cut(hr.is_day), wind: cut(hr.wind_speed_10m), gust: cut(hr.wind_gusts_10m), dir: cut(hr.wind_direction_10m) } : null,
          daily: dl.time ? { time: dl.time, code: dl.weather_code, max: dl.temperature_2m_max, min: dl.temperature_2m_min, sunrise: dl.sunrise, sunset: dl.sunset,
            psum: dl.precipitation_sum, ppmax: dl.precipitation_probability_max, uvmax: dl.uv_index_max } : null };
        store('weather', w);
        showWeather(w, false);
        renderSun();
      } else {
        showWeather(cached, true);
      }
      weatherTimer = setTimeout(weather, maxAge);
    }, 12000);
  }

  /* ---------- Back from another app ---------- */
  function onVisibility() {
    if (document.hidden) { clearTimeout(idleTimer); clearTimeout(tickTimer); radioStop(); globeStop(); return; }
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
    setTimeout(function () { checkUpdate(false); }, 15000);
    setInterval(function () { if (!document.hidden) { checkUpdate(false); } }, 6 * 3600000);
    radioLoad();
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
