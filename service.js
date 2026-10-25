/* Greenwood Hub service (runs inside TizenBrew's Node service on the TV).
 *
 * Jobs (the hub page has no Tizen API; this service does):
 *  1. /apps               list installed, visible apps (read from this TV) for the All apps screen.
 *  2. /icon?id=<appId>    the icon file of an app from that list (no other files are served).
 *  3. /launch?id=<appId>  open an app: fixed IDs below + apps on the TV's own list.
 *  4. /key?k=KEY_*        send ONE remote key (HDMI 1-3, Menu, Source, Home) to the TV's remote API.
 *  5. /log                last 20 remote-key results (diagnostics).
 *  6. /status             health summary for the About screen.
 *  7. /calendar           upcoming events (today + tomorrow) from the secret iCal links stored on the TV.
 *  8. /setup/start|status|stop|forget   one-time calendar setup. While active (max 10 min) a second
 *                         listener on port 8096 accepts the links from the laptop, only with the
 *                         6-digit code shown on the TV. Only calendar.google.com iCal links are accepted.
 *  9. /sleep?min=N        sleep timer: after N minutes, if the TV is still on, send KEY_POWER once.
 *
 * Secrets (calendar links, remote token) are stored only on the TV in /home/owner/share and are
 * never sent anywhere except to calendar.google.com (the link itself).
 *
 * - Listens on 127.0.0.1:8095 only (not reachable from the network).
 * - Talks to wss://127.0.0.1:8002 (the TV's own remote API, self-signed cert).
 *   This TV refuses the plain ws://:8001 socket (ms.channel.unauthorized).
 * - First use: the TV shows an "Allow" prompt for "Greenwood Hub". The token it returns
 *   is saved to /home/owner/share/greenwoodHubToken.txt (stays on the TV, never sent anywhere).
 * - ES5 only (TizenBrew services may run on old Node). No dependencies: Node built-ins only.
 */
'use strict';

var http = require('http');
var https = require('https');
var os = require('os');
var tls = require('tls');
var fs = require('fs');
var crypto = require('crypto');
var net = require('net');

var VERSION = '0.7.3';
var REPO = 'RichGreenwood/greenwood-tv-hub';
var TB_CFG = '/home/owner/share/tizenbrewConfig.json';
var TB_BACKUP = '/home/owner/share/tizenbrewConfig.greenwood-backup.json';
var MOD_RE = /^gh\/RichGreenwood\/greenwood-tv-hub(@[^\/]*)?$/i;
var retired = false; /* true after a newer hub version took over */
var PORT = 8095;
var SETUP_PORT = 8096;
var CFG_FILE = '/home/owner/share/greenwoodHub.json';
var STARTED = Date.now();
var TOKEN_FILE = '/home/owner/share/greenwoodHubToken.txt';
var NAME_B64 = new Buffer('Greenwood Hub').toString('base64');
var ALLOWED = ['KEY_HDMI1', 'KEY_HDMI2', 'KEY_HDMI3', 'KEY_MENU', 'KEY_SOURCE', 'KEY_HOME', 'KEY_VOLUP', 'KEY_VOLDOWN'];
/* Not shown in All apps (Samsung extras, not useful to open): Samsung Promotion, Privacy Choices */
var APP_HIDE_IDS = ['3201807016658', '3201909019271'];
var APPS = [ /* native app IDs read from this TV (apps.csv, 24 Oct 2026). Add here when apps.json changes. */
  '3202301029760', /* HBO Max */
  '3201907018807', /* Netflix */
  '3201701011479', /* Tet+ */
  '111299001912',  /* YouTube */
  '3201606009684', /* Spotify */
  'org.tizen.browser', /* Internet */
  /* fallback list for All apps (apps.json "_all") */
  '3201807016597', '3201806016390', '20192100002', '3201710015037', '3202204027283',
  '3201505002589', '3201511006428', '11111300404', '3201909019271'
];
var HIDE = /^(xvvl3S1bvH|xvvl3S1bTI)\./; /* TizenBrew + its installer: not shown in All apps */
var appCache = { at: 0, list: [], icons: {} };
var WAIT_MS = 30000; /* time for Ričards to press Allow on first use */

function readToken() {
  try { return String(fs.readFileSync(TOKEN_FILE, 'utf8')).replace(/[^0-9A-Za-z]/g, ''); } catch (e) { return ''; }
}
function saveToken(t) {
  try { fs.writeFileSync(TOKEN_FILE, String(t)); } catch (e) { /* not fatal */ }
}

/* Minimal WebSocket client frame (text, masked, payload < 64 KB). */
function frame(text) {
  var payload = new Buffer(text, 'utf8');
  var len = payload.length;
  var head = len < 126 ? new Buffer(2) : new Buffer(4);
  head[0] = 0x81;
  if (len < 126) { head[1] = 0x80 | len; } else { head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  var mask = crypto.randomBytes(4);
  var body = new Buffer(len);
  for (var i = 0; i < len; i++) { body[i] = payload[i] ^ mask[i % 4]; }
  return Buffer.concat([head, mask, body]);
}

/* Parse unmasked server frames from buf; returns { messages: [text], rest: Buffer }. */
function parseFrames(buf) {
  var messages = [];
  while (buf.length >= 2) {
    var len = buf[1] & 0x7f;
    var off = 2;
    if (len === 126) { if (buf.length < 4) { break; } len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) { break; } len = buf.readUInt32BE(6); off = 10; }
    if (buf.length < off + len) { break; }
    var op = buf[0] & 0x0f;
    if (op === 0x1) { messages.push(buf.slice(off, off + len).toString('utf8')); }
    buf = buf.slice(off + len);
  }
  return { messages: messages, rest: buf };
}

function sendKey(key, cb, host) {
  host = host || '127.0.0.1';
  var token = readToken();
  var path = '/api/v2/channels/samsung.remote.control?name=' + NAME_B64 +
    (token ? '&token=' + token : '');
  var done = false;
  var upgraded = false;
  var buf = new Buffer(0);
  var sock;
  var last = 'none'; /* last thing seen, for the on-screen error */
  var timer = setTimeout(function () { finish('timeout'); }, WAIT_MS);

  function finish(err) {
    if (done) { return; }
    done = true;
    clearTimeout(timer);
    try { sock.end(); } catch (e) { /* ignore */ }
    log((err || 'ok') + ' ' + key + ' via ' + host + ' after ' + last + (token ? ' (token)' : ' (no token)'));
    cb(err, last);
  }

  try {
    sock = tls.connect({ host: host, port: 8002, rejectUnauthorized: false }, function () {
      var wsKey = crypto.randomBytes(16).toString('base64');
      sock.write('GET ' + path + ' HTTP/1.1\r\n' +
        'Host: ' + host + ':8002\r\n' +
        'Origin: https://' + host + ':8002\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + wsKey + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
  } catch (e) { finish('connect'); return; }

  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) { return; }
      var headers = buf.slice(0, end).toString('utf8');
      last = 'http ' + headers.split('\r\n')[0].replace(/[^ -~]/g, '').slice(0, 40);
      if (headers.indexOf(' 101') < 0) { finish('handshake'); return; }
      upgraded = true;
      buf = buf.slice(end + 4);
    }
    var parsed = parseFrames(buf);
    buf = parsed.rest;
    parsed.messages.forEach(function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      last = String(msg.event || 'message');
      if (msg.event === 'ms.channel.connect') {
        if (msg.data && msg.data.token) { saveToken(msg.data.token); }
        sock.write(frame(JSON.stringify({ method: 'ms.remote.control', params: {
          Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } })));
        setTimeout(function () { finish(null); }, 1000);
      } else if (msg.event === 'ms.channel.unauthorized' || msg.event === 'ms.channel.timeOut') {
        finish('denied');
      }
    });
  });
  sock.on('error', function (e) { last = 'socket ' + String((e && e.code) || (e && e.message) || 'error').slice(0, 40); finish('error'); });
  sock.on('close', function () { finish(upgraded ? 'closed' : 'error'); });
}

/* Samsung's own list of installed apps (the same apps as the TV's Apps screen), over the remote channel. */
function samsungApps(cb, host) {
  host = host || keyHost || '127.0.0.1';
  var token = readToken();
  if (!token) { cb('no token'); return; }
  var done = false, upgraded = false, buf = new Buffer(0), sock;
  var timer = setTimeout(function () { finish('timeout'); }, 12000);
  function finish(err, list) { if (done) { return; } done = true; clearTimeout(timer); try { sock.end(); } catch (e) { /* ignore */ } cb(err, list); }
  try {
    sock = tls.connect({ host: host, port: 8002, rejectUnauthorized: false }, function () {
      sock.write('GET /api/v2/channels/samsung.remote.control?name=' + NAME_B64 + '&token=' + token + ' HTTP/1.1\r\n' +
        'Host: ' + host + ':8002\r\nOrigin: https://' + host + ':8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
  } catch (e) { finish('connect'); return; }
  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) { return; }
      if (buf.slice(0, end).toString('utf8').indexOf(' 101') < 0) { finish('handshake'); return; }
      upgraded = true; buf = buf.slice(end + 4);
    }
    var parsed = parseFrames(buf); buf = parsed.rest;
    parsed.messages.forEach(function (text) {
      var msg; try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.event === 'ms.channel.connect') {
        sock.write(frame(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } })));
      } else if (msg.event === 'ed.installedApp.get') {
        var d = msg.data && msg.data.data;
        finish(d && d.length ? null : 'empty', d);
      } else if (msg.event === 'ms.channel.unauthorized' || msg.event === 'ms.channel.timeOut') { finish('denied'); }
    });
  });
  sock.on('error', function () { finish('error'); });
}
/* Fallback filter for tizen.application.getAppsInfo: store apps only (random 10-character package prefix),
   plus the Internet browser; Samsung system services and TizenBrew stay hidden. */
var SYS_PREFIX = /^(ZODRT12q2l|aQjWjLsPaO|30IKH0OX8U|xvvl3S1bvH|xvvl3S1bTI)\./;
function usableTizenApp(a) {
  if (a.id === 'org.tizen.browser') { return true; }
  if (!/^[A-Za-z0-9]{10}\.[A-Za-z0-9_]+$/.test(a.id) || SYS_PREFIX.test(a.id)) { return false; }
  return !/promotion|privacy|manual|launcher|extension|service|agent|widget/i.test(a.name || '');
}
function readApps(cb) {
  if (Date.now() - appCache.at < 10 * 60000 && appCache.list.length) { cb(null, appCache.list); return; }
  samsungApps(function (err, data) {
    if (!err && data) {
      var list = [], icons = {};
      data.forEach(function (a) {
        if (!a || !a.appId || !a.name || APP_HIDE_IDS.indexOf(String(a.appId)) >= 0) { return; }
        var id = String(a.appId);
        if (a.icon) { icons[id] = String(a.icon); }
        list.push({ id: id, name: String(a.name), icon: !!a.icon });
      });
      appCache = { at: Date.now(), list: list, icons: icons, source: 'samsung' };
      cb(null, list);
      return;
    }
    log('app list via Samsung channel: ' + err + ', using filtered app list');
    readTizenApps(cb);
  });
}
function readTizenApps(cb) {
  if (typeof tizen === 'undefined' || !tizen.application || !tizen.application.getAppsInfo) { cb('no tizen api'); return; }
  try {
    tizen.application.getAppsInfo(function (infos) {
      var list = [], icons = {}, seen = {};
      (infos || []).forEach(function (a) {
        if (!a || !a.id || a.show === false || HIDE.test(a.id) || !a.name || !usableTizenApp(a)) { return; }
        if (seen[a.id]) { return; }
        seen[a.id] = true;
        var ip = a.iconPath ? String(a.iconPath).replace(/^file:\/\//, '') : '';
        if (ip) { icons[a.id] = ip; }
        list.push({ id: String(a.id), name: String(a.name), icon: !!ip });
      });
      appCache = { at: Date.now(), list: list, icons: icons, source: 'tizen' };
      cb(null, list);
    }, function (e) { cb((e && e.name) ? e.name : 'getAppsInfo error'); });
  } catch (e) { cb((e && e.name) ? e.name : 'getAppsInfo error'); }
}

function onList(appId) {
  for (var i = 0; i < appCache.list.length; i++) { if (appCache.list[i].id === appId) { return true; } }
  return false;
}

function sendIcon(appId, res) {
  var p = appCache.icons[appId];
  if (!p) { res.statusCode = 404; res.end(); return; }
  var ext = (p.split('.').pop() || '').toLowerCase();
  var type = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
  fs.readFile(p, function (err, data) {
    if (err) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'max-age=86400');
    res.end(data);
  });
}

function launch(appId, res) {
  if (APPS.indexOf(appId) < 0 && !onList(appId)) { res.statusCode = 403; res.end('{"ok":false,"error":"not allowed"}'); return; }
  if (typeof tizen === 'undefined' || !tizen.application) { res.end('{"ok":false,"error":"no tizen api"}'); return; }
  try {
    tizen.application.launch(appId,
      function () { res.end('{"ok":true}'); },
      function (e) { res.end(JSON.stringify({ ok: false, error: (e && e.name) ? e.name : 'launch error' })); });
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: (e && e.name) ? e.name : 'launch error' }));
  }
}

/* ---------- Config (stored on the TV only) ---------- */
function readCfg() {
  try { return JSON.parse(String(fs.readFileSync(CFG_FILE, 'utf8'))) || {}; } catch (e) { return {}; }
}
function writeCfg(c) {
  try { fs.writeFileSync(CFG_FILE, JSON.stringify(c)); return true; } catch (e) { return false; }
}

/* ---------- iCal (ICS) reader: today + tomorrow ---------- */
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function parseIcsDate(v, params) {
  /* returns { y, mo, d, h, mi, s, utc: bool, allDay: bool, tzid } */
  var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(v).trim());
  if (!m) { return null; }
  return {
    y: +m[1], mo: +m[2], d: +m[3],
    h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0,
    utc: !!m[7], allDay: !m[4] || (params && params.VALUE === 'DATE'),
    tzid: params && params.TZID ? String(params.TZID).replace(/^"|"$/g, '') : ''
  };
}

function parseLines(text) {
  var lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  var out = [];
  lines.forEach(function (line) {
    if (!line) { return; }
    var colon = -1, inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') { inQ = !inQ; }
      else if (c === ':' && !inQ) { colon = i; break; }
    }
    if (colon < 0) { return; }
    var head = line.slice(0, colon), value = line.slice(colon + 1);
    var parts = head.split(';');
    var params = {};
    for (var j = 1; j < parts.length; j++) {
      var eq = parts[j].indexOf('=');
      if (eq > 0) { params[parts[j].slice(0, eq).toUpperCase()] = parts[j].slice(eq + 1); }
    }
    out.push({ name: parts[0].toUpperCase(), params: params, value: value });
  });
  return out;
}

function unescapeText(v) {
  return String(v).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

function parseRrule(v) {
  var r = {};
  String(v).split(';').forEach(function (kv) {
    var eq = kv.indexOf('=');
    if (eq > 0) { r[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1); }
  });
  return r;
}

var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/* n-th weekday of a month (n = 1..5 or -1..-5), returns day of month or 0 */
function nthWeekday(y, mo, n, wd) {
  var days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (n > 0) {
    var first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    var d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return d <= days ? d : 0;
  }
  var lastWd = new Date(Date.UTC(y, mo - 1, days)).getUTCDay();
  var dl = days - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
  return dl >= 1 ? dl : 0;
}

/* VTIMEZONE -> offset (minutes) at a UTC instant */
function parseOffset(v) {
  var m = /^([+-])(\d{2})(\d{2})/.exec(String(v));
  if (!m) { return 0; }
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}
function tzTransitions(tz, year) {
  var list = [];
  tz.rules.forEach(function (r) {
    for (var y = year - 1; y <= year + 1; y++) {
      var mo, d;
      if (r.rrule && r.rrule.BYMONTH) {
        mo = +r.rrule.BYMONTH;
        var bd = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(r.rrule.BYDAY || '');
        if (bd) { d = nthWeekday(y, mo, bd[1] ? +bd[1] : 1, WD[bd[2]]); }
        else if (r.rrule.BYMONTHDAY) { d = +r.rrule.BYMONTHDAY; }
        else { d = r.start.d; }
      } else {
        if (y !== r.start.y) { continue; }
        mo = r.start.mo; d = r.start.d;
      }
      if (!d || y < r.start.y) { continue; }
      var wallMs = Date.UTC(y, mo - 1, d, r.start.h, r.start.mi, r.start.s);
      list.push({ at: wallMs - r.from * 60000, offset: r.to });
    }
  });
  list.sort(function (a, b) { return a.at - b.at; });
  return list;
}
function tzOffsetAt(tz, utcMs) {
  var y = new Date(utcMs).getUTCFullYear();
  var tr = tzTransitions(tz, y);
  var off = tz.rules.length ? tz.rules[0].from : 0;
  for (var i = 0; i < tr.length; i++) { if (tr[i].at <= utcMs) { off = tr[i].offset; } }
  return off;
}

/* Built-in fallback rules when the file has no VTIMEZONE for a TZID */
var EU_ZONES = { 'Europe/Riga': 120, 'Europe/Tallinn': 120, 'Europe/Vilnius': 120, 'Europe/Helsinki': 120,
  'Europe/Vienna': 60, 'Europe/Berlin': 60, 'Europe/Paris': 60, 'Europe/Amsterdam': 60, 'Europe/Madrid': 60,
  'Europe/Rome': 60, 'Europe/Stockholm': 60, 'Europe/Warsaw': 60, 'Europe/London': 0, 'Europe/Dublin': 0, 'Europe/Lisbon': 0 };
var US_ZONES = { 'America/New_York': -300, 'America/Chicago': -360, 'America/Denver': -420, 'America/Los_Angeles': -480 };
function builtinZone(tzid) {
  if (tzid === 'UTC' || tzid === 'Etc/UTC' || tzid === 'GMT') { return { rules: [] , fixed: 0 }; }
  if (EU_ZONES.hasOwnProperty(tzid)) {
    var std = EU_ZONES[tzid];
    /* EU: summer time from last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC */
    return { rules: [
      { from: std, to: std + 60, start: { y: 1996, mo: 3, d: 31, h: Math.floor((60 + std) / 60), mi: 0, s: 0 }, rrule: { BYMONTH: '3', BYDAY: '-1SU' } },
      { from: std + 60, to: std, start: { y: 1996, mo: 10, d: 27, h: Math.floor((60 + std + 60) / 60), mi: 0, s: 0 }, rrule: { BYMONTH: '10', BYDAY: '-1SU' } }
    ] };
  }
  if (US_ZONES.hasOwnProperty(tzid)) {
    var us = US_ZONES[tzid];
    return { rules: [
      { from: us, to: us + 60, start: { y: 2007, mo: 3, d: 11, h: 2, mi: 0, s: 0 }, rrule: { BYMONTH: '3', BYDAY: '2SU' } },
      { from: us + 60, to: us, start: { y: 2007, mo: 11, d: 4, h: 2, mi: 0, s: 0 }, rrule: { BYMONTH: '11', BYDAY: '1SU' } }
    ] };
  }
  return null;
}

/* wall-clock fields in a zone -> UTC ms. Floating times use the TV's own local time. */
function wallToUtc(f, zones) {
  if (f.allDay) { return new Date(f.y, f.mo - 1, f.d, 0, 0, 0).getTime(); }
  if (f.utc) { return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s); }
  var tz = f.tzid ? (zones[f.tzid] || builtinZone(f.tzid)) : null;
  if (!tz) { return new Date(f.y, f.mo - 1, f.d, f.h, f.mi, f.s).getTime(); }
  var wall = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
  if (typeof tz.fixed === 'number') { return wall - tz.fixed * 60000; }
  var guess = wall - (tz.rules.length ? tz.rules[0].from : 0) * 60000;
  var off = tzOffsetAt(tz, guess);
  var utc = wall - off * 60000;
  var off2 = tzOffsetAt(tz, utc);
  if (off2 !== off) { utc = wall - off2 * 60000; }
  return utc;
}

function addDaysF(f, n) {
  var dt = new Date(Date.UTC(f.y, f.mo - 1, f.d + n, f.h, f.mi, f.s));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: f.h, mi: f.mi, s: f.s, utc: f.utc, allDay: f.allDay, tzid: f.tzid };
}
function withDate(f, y, mo, d) {
  return { y: y, mo: mo, d: d, h: f.h, mi: f.mi, s: f.s, utc: f.utc, allDay: f.allDay, tzid: f.tzid };
}
function weekday(f) { return new Date(Date.UTC(f.y, f.mo - 1, f.d)).getUTCDay(); }

/* Occurrence starts (wall fields) of an event between winStart and winEnd (UTC ms). */
function expand(ev, winStart, winEnd, zones) {
  var out = [];
  var durMs = ev.endMs - ev.startMs;
  if (!ev.rrule) { return [ev.start]; }
  var r = ev.rrule;
  var freq = r.FREQ || '';
  var interval = Math.max(1, +(r.INTERVAL || 1));
  var count = r.COUNT ? +r.COUNT : 0;
  var untilMs = Infinity;
  if (r.UNTIL) { var uf = parseIcsDate(r.UNTIL, {}); if (uf) { untilMs = uf.allDay ? new Date(uf.y, uf.mo - 1, uf.d, 23, 59, 59).getTime() : wallToUtc(uf, zones); } }
  var byday = r.BYDAY ? r.BYDAY.split(',') : [];
  var bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [];
  var n = 0, guard = 0;
  function take(f) {
    var ms = wallToUtc(f, zones);
    if (ms < ev.startMs) { return true; }
    if (ms > untilMs) { return false; }
    n++;
    if (count && n > count) { return false; }
    if (ms + durMs > winStart && ms < winEnd) { out.push(f); }
    return ms < winEnd;
  }
  var s = ev.start;
  if (freq === 'DAILY') {
    for (var i = 0; guard++ < 20000; i += interval) { if (!take(addDaysF(s, i))) { break; } }
  } else if (freq === 'WEEKLY') {
    var days = byday.length ? byday.map(function (x) { return WD[x.slice(-2)]; }).sort() : [weekday(s)];
    var weekStart = addDaysF(s, -((weekday(s) + 6) % 7)); /* Monday of the first week */
    outer: for (var w = 0; guard++ < 5000; w += interval) {
      var mon = addDaysF(weekStart, w * 7);
      var order = days.map(function (d) { return (d + 6) % 7; }).sort(function (a, b) { return a - b; });
      for (var k = 0; k < order.length; k++) {
        if (!take(addDaysF(mon, order[k]))) { break outer; }
      }
    }
  } else if (freq === 'MONTHLY') {
    for (var mstep = 0; guard++ < 2000; mstep += interval) {
      var base = new Date(Date.UTC(s.y, s.mo - 1 + mstep, 1));
      var y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1;
      var dlist = [];
      if (byday.length) {
        byday.forEach(function (x) {
          var mm = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x);
          if (mm && mm[1]) { var dd = nthWeekday(y, mo, +mm[1], WD[mm[2]]); if (dd) { dlist.push(dd); } }
        });
      } else if (bymd.length) {
        var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        bymd.forEach(function (x) { var dd = x < 0 ? dim + 1 + x : x; if (dd >= 1 && dd <= dim) { dlist.push(dd); } });
      } else {
        var dim2 = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        if (s.d <= dim2) { dlist.push(s.d); }
      }
      dlist.sort(function (a, b) { return a - b; });
      var stop = false;
      for (var q = 0; q < dlist.length; q++) { if (!take(withDate(s, y, mo, dlist[q]))) { stop = true; break; } }
      if (stop || Date.UTC(y, mo - 1, 1) > winEnd + 86400000 * 31) { break; }
    }
  } else if (freq === 'YEARLY') {
    for (var ystep = 0; guard++ < 200; ystep += interval) {
      var yy = s.y + ystep;
      if (s.mo === 2 && s.d === 29 && new Date(Date.UTC(yy, 1, 29)).getUTCMonth() !== 1) { continue; }
      if (!take(withDate(s, yy, s.mo, s.d))) { break; }
    }
  } else {
    return [s];
  }
  return out;
}

function eventsFromIcs(text, winStart, winEnd, calIndex, label) {
  var lines = parseLines(text);
  var zones = {}, events = [], stack = [], cur = null, curTz = null, curRule = null;
  lines.forEach(function (p) {
    if (p.name === 'BEGIN') {
      stack.push(p.value);
      if (p.value === 'VEVENT') { cur = { exdates: {}, status: '' }; }
      else if (p.value === 'VTIMEZONE') { curTz = { id: '', rules: [] }; }
      else if ((p.value === 'STANDARD' || p.value === 'DAYLIGHT') && curTz) { curRule = { from: 0, to: 0, start: null, rrule: null }; }
      return;
    }
    if (p.name === 'END') {
      stack.pop();
      if (p.value === 'VEVENT' && cur) { events.push(cur); cur = null; }
      else if (p.value === 'VTIMEZONE' && curTz) { if (curTz.id) { zones[curTz.id] = curTz; } curTz = null; }
      else if ((p.value === 'STANDARD' || p.value === 'DAYLIGHT') && curRule && curTz) { if (curRule.start) { curTz.rules.push(curRule); } curRule = null; }
      return;
    }
    if (curRule) {
      if (p.name === 'TZOFFSETFROM') { curRule.from = parseOffset(p.value); }
      else if (p.name === 'TZOFFSETTO') { curRule.to = parseOffset(p.value); }
      else if (p.name === 'DTSTART') { curRule.start = parseIcsDate(p.value, {}); }
      else if (p.name === 'RRULE') { curRule.rrule = parseRrule(p.value); }
      return;
    }
    if (curTz && p.name === 'TZID') { curTz.id = p.value; return; }
    if (!cur) { return; }
    if (p.name === 'UID') { cur.uid = p.value; }
    else if (p.name === 'SUMMARY') { cur.summary = unescapeText(p.value); }
    else if (p.name === 'DTSTART') { cur.start = parseIcsDate(p.value, p.params); }
    else if (p.name === 'DTEND') { cur.end = parseIcsDate(p.value, p.params); }
    else if (p.name === 'DURATION') { cur.duration = p.value; }
    else if (p.name === 'RRULE') { cur.rrule = parseRrule(p.value); }
    else if (p.name === 'STATUS') { cur.status = String(p.value).toUpperCase(); }
    else if (p.name === 'TRANSP') { cur.transp = String(p.value).toUpperCase(); }
    else if (p.name === 'RECURRENCE-ID') { cur.recurrenceId = parseIcsDate(p.value, p.params); }
    else if (p.name === 'EXDATE') {
      String(p.value).split(',').forEach(function (v) { var f = parseIcsDate(v, p.params); if (f) { cur.exdatesF = (cur.exdatesF || []).concat([f]); } });
    }
  });

  function durationMs(v) {
    var m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || ''));
    if (!m) { return 0; }
    return ((+(m[1] || 0) * 7 + +(m[2] || 0)) * 86400 + +(m[3] || 0) * 3600 + +(m[4] || 0) * 60 + +(m[5] || 0)) * 1000;
  }

  var overrides = {};
  events.forEach(function (ev) {
    if (!ev.start) { return; }
    ev.startMs = wallToUtc(ev.start, zones);
    if (ev.end) { ev.endMs = wallToUtc(ev.end, zones); }
    else if (ev.duration) { ev.endMs = ev.startMs + durationMs(ev.duration); }
    else { ev.endMs = ev.startMs + (ev.start.allDay ? 86400000 : 0); }
    (ev.exdatesF || []).forEach(function (f) { ev.exdates[wallToUtc(f, zones)] = true; });
    if (ev.recurrenceId && ev.uid) {
      overrides[ev.uid] = overrides[ev.uid] || {};
      overrides[ev.uid][wallToUtc(ev.recurrenceId, zones)] = true;
    }
  });

  var result = [];
  events.forEach(function (ev) {
    if (!ev.start || ev.status === 'CANCELLED') { return; }
    var dur = ev.endMs - ev.startMs;
    var starts = ev.recurrenceId ? [ev.start] : expand(ev, winStart, winEnd, zones);
    starts.forEach(function (f) {
      var ms = wallToUtc(f, zones);
      if (ev.exdates[ms]) { return; }
      if (!ev.recurrenceId && ev.rrule && ev.uid && overrides[ev.uid] && overrides[ev.uid][ms]) { return; }
      var endMs = ms + dur;
      if (ev.start.allDay) { var ef = addDaysF(f, Math.max(1, Math.round(dur / 86400000))); endMs = wallToUtc(ef, zones); }
      if (ms < winEnd && endMs > winStart) {
        result.push({ start: ms, end: endMs, allDay: !!ev.start.allDay, title: ev.summary || '(no title)', cal: calIndex, label: label });
      }
    });
  });
  return result;
}

/* ---------- Calendar fetch (cached 15 min) ---------- */
var calCache = { at: 0, events: [], errors: [], fetching: false, waiters: [] };

function fetchText(url, cb, depth) {
  depth = depth || 0;
  var done = false;
  function finish(err, text) { if (!done) { done = true; cb(err, text); } }
  try {
    var req = https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 3) {
        res.resume();
        var loc = res.headers.location;
        if (!/^https:\/\/([a-z0-9-]+\.)*google(usercontent)?\.com\//.test(loc)) { finish('redirect blocked'); return; }
        fetchText(loc, finish, depth + 1);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); finish('HTTP ' + res.statusCode); return; }
      var chunks = [], size = 0;
      res.on('data', function (c) {
        size += c.length;
        if (size > 8 * 1024 * 1024) { req.abort(); finish('too large'); return; }
        chunks.push(c);
      });
      res.on('end', function () { finish(null, Buffer.concat(chunks).toString('utf8')); });
    });
    req.setTimeout(20000, function () { req.abort(); finish('timeout'); });
    req.on('error', function (e) { finish((e && e.code) || 'network'); });
  } catch (e) { finish('request error'); }
}

function calendarWindow() {
  var now = new Date();
  /* Monday of this week (week strip) to the end of today + 7 days (week calendar) */
  var back = (now.getDay() + 6) % 7;
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime();
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8).getTime();
  return { start: start, end: end };
}

function readCalendar(force, cb) {
  var cals = (readCfg().calendars || []);
  if (!cals.length) { cb({ ok: true, configured: 0, events: [] }); return; }
  if (!force && Date.now() - calCache.at < 15 * 60000) {
    cb({ ok: true, configured: cals.length, events: calCache.events, errors: calCache.errors, at: calCache.at });
    return;
  }
  calCache.waiters.push(cb);
  if (calCache.fetching) { return; }
  calCache.fetching = true;
  var win = calendarWindow();
  var all = [], errors = [], left = cals.length;
  cals.forEach(function (c, i) {
    fetchText(c.url, function (err, text) {
      if (err) { errors.push({ cal: i, label: c.label, error: err }); }
      else {
        try { all = all.concat(eventsFromIcs(text, win.start, win.end, i, c.label)); }
        catch (e) { errors.push({ cal: i, label: c.label, error: 'parse' }); }
      }
      if (--left === 0) {
        all.sort(function (a, b) { return (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start - b.start; });
        /* keep the old list if every calendar failed (offline): show last known */
        if (errors.length < cals.length || !calCache.events.length) { calCache.events = all; }
        calCache.errors = errors;
        calCache.at = Date.now();
        calCache.fetching = false;
        var ws = calCache.waiters; calCache.waiters = [];
        ws.forEach(function (w) { w({ ok: true, configured: cals.length, events: calCache.events, errors: errors, at: calCache.at }); });
      }
    });
  });
}

/* Current public root certificates (Mozilla list, Oct 2026) for Quick play streams whose certificates are newer
   than the TV's own 2019 list (Let's Encrypt, Sectigo, Google, Amazon, DigiCert ...). Used only when the TV's own
   list cannot check a station; certificates are always checked. */
var RADIO_ROOTS = [
  /* ISRG Root X1 */ 'MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAwTzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2VhcmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygch77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6UA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sWT8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyHB5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UCB5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUvKBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWnOlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTnjh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbwqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CIrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkqhkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZLubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KKNFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7UrTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdCjNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVcoyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPAmRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57demyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=',
  /* ISRG Root X2 */ 'MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBTZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZIzj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdWtL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1/q4AaOeMSQ+2b1tbFfLn',
  /* DigiCert Global Root G2 */ 'MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBhMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQq2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5WztCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQvIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NGFdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ918rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTepLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTflMrY=',
  /* DigiCert Global Root G3 */ 'MIICPzCCAcWgAwIBAgIQBVVWvPJepDU1w6QP1atFcjAKBggqhkjOPQQDAzBhMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMzAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEczMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE3afZu4q4C/sLfyHS8L6+c/MzXRq8NOrexpu80JX28MzQC7phW1FGfp4tn+6OYwwX7Adw9c+ELkCDnOg/QW07rdOkFFk2eJ0DQ+4QE2xy3q6Ip6FrtUPOZ9wj/wMco+I+o0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUs9tIpPmhxdiuNkHMEWNpYim8S8YwCgYIKoZIzj0EAwMDaAAwZQIxAK288mw/EkrRLTnDCgmXc/SINoyIJ7vmiI1Qhadj+Z4y3maTD/HMsQmP3Wyr+mt/oAIwOWZbwmSNuJ5Q3KjVSaLtx9zRSX8XAbjIho9OjIgrqJqpisXRAL34VOKa5Vt8sycX',
  /* DigiCert TLS RSA4096 Root G5 */ 'MIIFZjCCA06gAwIBAgIQCPm0eKj6ftpqMzeJ3nzPijANBgkqhkiG9w0BAQwFADBNMQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xJTAjBgNVBAMTHERpZ2lDZXJ0IFRMUyBSU0E0MDk2IFJvb3QgRzUwHhcNMjEwMTE1MDAwMDAwWhcNNDYwMTE0MjM1OTU5WjBNMQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xJTAjBgNVBAMTHERpZ2lDZXJ0IFRMUyBSU0E0MDk2IFJvb3QgRzUwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCz0PTJeRGd/fxmgefM1eS87IE+ajWOLrfn3q/5B03PMJ3qCQuZvWxX2hhKuHisOjmopkisLnLlvevxGs3npAOpPxG02C+JFvuUAT27L/gTBaF4HI4o4EXgg/RZG5Wzrn4DReW+wkL+7vI8toUTmDKdFqgpwgscONyfMXdcvyej/Cestyu9dJsXLfKB2l2w4SMXPohKEiPQ6s+d3gMXsUJKoBZMpG2T6T867jp8nVid9E6P/DsjyG244gXazOvswzH016cpVIDPRFtMbzCe88zdH5RDnU1/cHAN1DrRN/BsnZvAFJNY781BOHW8EwOVfH/jXOnVDdXifBBiqmvwPXbzP6PosMH976pXTayGpxi0KcEsDr9kvimM2AItzVwv8n/vFfQMFawKsPHTDU9qTXeXAaDxZre3zu/O7Oyldcqs4+Fj97ihBMi8ez9dLRYiVu1ISf6nL3kwJZu6ay0/nTvEF+cdLvvyz6b84xQslpghjLSR6Rlgg/IwKwZzUNWYOwbpx4oMYIwo+FKbbuH2TbsGJJvXKyY//SovcfXWJL5/MZ4PbeiPT02jP/816t9JXkGPhvnxd3lLG7SjXi/7RgLQZhNeXoVPzthwiHvOAbWWl9fNff2C+MIkwcoBOU+NosEUQB+cZtUMCUbW8tDRSHZWOkPLtgoRObqME2wGtZ7P6wIDAQABo0IwQDAdBgNVHQ4EFgQUUTMc7TZArxfTJc1paPKvTiM+s0EwDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAGCmr1tfV9qJ20tQqcQjNSH/0GEwhJG3PxDPJY7Jv0Y02cEhJhxwGXIeo8mH/qlDZJY6yFMECrZBu8RHANmfGBg7sg7zNOok992vIGCukihfNudd5N7HPNtQOa27PShNlnx2xlv0wdsUpasZYgcYQF+Xkdycx6u1UQ3maVNVzDl92sURVXLFO4uJ+DQtpBflF+aZfTCIITfNMBc9uPK8qHWgQ9w+iUuQrm0D4ByjoJYJu32jtyoQREtGBzRj7TG5BO6jm5qu5jF49OokYTurWGT/u4cnYiWB39yhL/btp/96j1EuMPikAdKFOV8BmZZvWltwGUb+hmA+rYAQCd05JS9Yf7vSdPD3Rh9GOUrYU9DzLjtxpdRv/PNn5AeP3SYZ4Y1b+qOTEZvpyDrDVWiakuFSdjjo4bq9+0/V77PnSIMx8IIh47a+p6tv75/fTM8BuGJqIz3nCU2AG3swpMPdB380vqQmsvZB6Akd4yCYqjdP//fx4ilwMUc/dNAUFvohigLVigmUdy7yWSiLfFCSCmZ4OIN1xLVaqBHG5cGdZlXPU8Sv13WFqUITVuwhd4GTWgzqltlJyqEI8pc7bZsEGCREjnwB8twl2F6GmrE52/WRMmrRpnCKovfepEWFJqgejF0pW8hL2JpqA15w8oVPbEtoL8pU9ozaMv7Da4M/OMZ+',
  /* DigiCert TLS ECC P384 Root G5 */ 'MIICGTCCAZ+gAwIBAgIQCeCTZaz32ci5PhwLBCou8zAKBggqhkjOPQQDAzBOMQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xJjAkBgNVBAMTHURpZ2lDZXJ0IFRMUyBFQ0MgUDM4NCBSb290IEc1MB4XDTIxMDExNTAwMDAwMFoXDTQ2MDExNDIzNTk1OVowTjELMAkGA1UEBhMCVVMxFzAVBgNVBAoTDkRpZ2lDZXJ0LCBJbmMuMSYwJAYDVQQDEx1EaWdpQ2VydCBUTFMgRUNDIFAzODQgUm9vdCBHNTB2MBAGByqGSM49AgEGBSuBBAAiA2IABMFEoc8Rl1Ca3iOCNQfN0MsYndLxf3c1TzvdlHJS7cI7+Oz6e2tYIOyZrsn8aLN1udsJ7MgT9U7GCh1mMEy7H0cKPGEQQil8pQgO4CLp0zVozptjn4S1mU1YoI71VOeVyaNCMEAwHQYDVR0OBBYEFMFRRVBZqz7nLFr6ICISB4CIfBFqMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMDA2gAMGUCMQCJao1H5+z8blUD2WdsJk6Dxv3J+ysTvLd6jLRl0mlpYxNjOyZQLgGheQaRnUi/wr4CMEfDFXuxoJGZSZOoPHzoRgaLLPIxAJSdYsiJvRmEFOml+wG4DXZDjC5Ty3zfDBeWUA==',
  /* USERTrust RSA Certification Authority */ 'MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAwMjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkYtJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmTYo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97lc6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4eeUB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeEHg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAdBgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPFUp/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KOVWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcRiQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYzeSf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZXHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRBVXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aBL6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfGjjxDah2nGN59PRbxYvnKkKj9',
  /* USERTrust ECC Certification Authority */ 'MIICjzCCAhWgAwIBAgIQXIuZxVqUxdJxVt7NiYDMJjAKBggqhkjOPQQDAzCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBFQ0MgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAwMjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBFQ0MgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQarFRaqfloI+d61SRvU8Za2EurxtW20eZzca7dnNYMYf3boIkDuAUU7FfO7l0/4iGzzvfUinngo4N+LZfQYcTxmdwlkWOrfzCjtHDix6EznPO/LlxTsV+zfTJ/ijTjeXmjQjBAMB0GA1UdDgQWBBQ64QmG1M8ZwpZ2dEl23OA1xmNjmjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAwNoADBlAjA2Z6EWCNzklwBBHU6+4WMBzzuqQhFkoJ2UOQIReVx7Hfpkue4WQrO/isIJxOzksU0CMQDpKmFHjFJKS04YcPbWRNZu9YO6bVi9JNlWSOrvxKJGgYhqOkbRqZtNyWHa0V1Xahg=',
  /* COMODO RSA Certification Authority */ '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',
  /* Sectigo Public Server Authentication Root R46 */ 'MIIFijCCA3KgAwIBAgIQdY39i658BwD6qSWn4cetFDANBgkqhkiG9w0BAQwFADBfMQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYwHhcNMjEwMzIyMDAwMDAwWhcNNDYwMzIxMjM1OTU5WjBfMQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCTvtU2UnXYASOgHEdCSe5jtrch/cSV1UgrJnwUUxDaef0rty2k1Cz66jLdScK5vQ9IPXtamFSvnl0xdE8H/FAh3aTPaE8bEmNtJZlMKpnzSDBh+oF8HqcIStw+KxwfGExxqjWMrfhu6DtK2eWUAtaJhBOqbchPM8xQljeSM9xfiOefVNlI8JhD1mb9nxc4Q8UBUQvX4yMPFF1bFOdLvt30yNoDN9HWOaEhUTCDsG3XME6WW5HwcCSrv0WBZEMNvSE6Lzzpng3LILVCJ8zab5vuZDCQOc2TZYEhMbUjUDM3IuM47fgxMMxF/mL50V0yeUKH32rMVhlATc6qu/m1dkmU8Sf4kaWD5QazYw6A3OASVYCmO2a0OYctyPDQ0RTp5A1NDvZdV3LFOxxHVp3i1fuBYYzMTYCQNFu31xR13NgESJ/AwSiItOkcyqex8Va3e0lMWeUgFaiEAin6OJRpmkkGj80feRQXEgyDet4fsZfu+Zd4KKTIRJLpfSYFplhym3kT2BFfrsU4YjRosoYwjviQYZ4ybPUHNs2iTG7sijbt8uaZFURww3y8nDnAtOFr94MlI1fZEoDlSfB1D++N6xybVCi0ITz8fAr/73trdf+LHaAZBav6+CuBQug4urv7qv094PPK306Xlynt8xhW6aWWrL3DkJiy4Pmi1KZHQ3xtzwIDAQABo0IwQDAdBgNVHQ4EFgQUVnNYZJX5khqwEioEYnmhQBWIIUkwDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAC9cmTz8Bl6MlC5w6tIyMY208FHVvArzZJ8HXtXBc2hkeqK5Duj5XYUtqDdFqij0lgVQYKlJfp/imTYpE0RHap1VIDzYm/EDMrraQKFz6oOht0SmDpkBm+S8f74TlH7Kph52gDY9hAaLMyZlbcp+nv4fjFg4exqDsQ+8FxG75gbMY/qB8oFM2gsQa6H61SilzwZAFv97fRheORKkU55+MkIQpiGRqRxOF3yEvJ+M0ejf5lG5Nkc/kLnHvALcWxxPDkjBJYOcCj+esQMzEhonrPcibCTRAUH4WAP+JWgiH5paPHxsnnVI84HxZmduTILA7rpXDhjvLpr3Etiga+kFpaHpaPi8TD8SHkXoUsCjvxInebnMMTzD9joiFgOgyY9mpFuiTdaBJQbpdqQACj7LzTWb4OE4y2BThihCQRxEV+ioratF4yUQvNs+ZUH7G6aXD+u5dHn5HrwdVw1Hr8Mvn4dGp+smWg9WY7ViYG4A++MnESLn/pmPNPW56MORcr3Ywx65LvKRRFHQV80MNNVIIb/bE/FmJUNS0nAiNs2fxBx1IK1jcmMGDw4nztJqDby1ORrp0XZ60Vzk50lJLVU3aPAaOpg+VBeHVOmmJ1CJeyAvP/+/oYtKR5j/K3tJPsMpRmAYQqszKbrAKbkTidOIijlBO8n9pu0f9GBj39ItVQGL',
  /* Sectigo Public Server Authentication Root E46 */ 'MIICOjCCAcGgAwIBAgIQQvLM2htpN0RfFf51KBC49DAKBggqhkjOPQQDAzBfMQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBFNDYwHhcNMjEwMzIyMDAwMDAwWhcNNDYwMzIxMjM1OTU5WjBfMQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBFNDYwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAR2+pmpbiDt+dd34wc7qNs9Xzjoq1WmVk/WSOrsfy2qw7LFeeyZYX8QeccCWvkEN/U0NSt3zn8gj1KjAIns1aeibVvjS5KToID1AZTc8GgHHs3u/iVStSBDHBv+6xnOQ6OjQjBAMB0GA1UdDgQWBBTRItpMWfFLXyY4qp3W7usNw/upYTAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAwNnADBkAjAn7qRaqCG76UeXlImldCBteU/IvZNeWBj7LRoAasm4PdCkT0RHlAFWovgzJQxC36oCMB3q4S6ILuH5px0CMk7yn2xVdOOurvulGu7t0vzCAxHrRVxgED1cf5kDW21USAGKcw==',
  /* GTS Root R1 */ 'MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7wCl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjwTcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0PfyblqAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaHszVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmkMiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70paDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrNVjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQIDAQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibbC5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEeQkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuyh6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM47HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8JZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6EfMgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bbbP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c',
  /* GTS Root R3 */ 'MIICCTCCAY6gAwIBAgINAgPluILrIPglJ209ZjAKBggqhkjOPQQDAzBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjMwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjMwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQfTzOHMymKoYTey8chWEGJ6ladK0uFxh1MJ7x/JlFyb+Kf1qPKzEUURout736GjOyxfi//qXGdGIRFBEFVbivqJn+7kAHjSxm65FSWRQmx1WyRRK2EE46ajA2ADDL24CejQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBTB8Sa6oC2uhYHP0/EqEr24Cmf9vDAKBggqhkjOPQQDAwNpADBmAjEA9uEglRR7VKOQFhG/hMjqb2sXnh5GmCCbn9MN2azTL818+FsuVbu/3ZL3pAzcMeGiAjEA/JdmZuVDFhOD3cffL74UOO0BzrEXGhF16b0DjyZ+hOXJYKaV11RZt+cRLInUue4X',
  /* GTS Root R4 */ 'MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyiQHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvRHYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD',
  /* GlobalSign Root CA - R3 */ 'MIIDXzCCAkegAwIBAgILBAAAAAABIVhTCKIwDQYJKoZIhvcNAQELBQAwTDEgMB4GA1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjMxEzARBgNVBAoTCkdsb2JhbFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMDkwMzE4MTAwMDAwWhcNMjkwMzE4MTAwMDAwWjBMMSAwHgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSMzETMBEGA1UEChMKR2xvYmFsU2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMwldpB5BngiFvXAg7aEyiie/QV2EcWtiHL8RgJDx7KKnQRfJMsuS+FggkbhUqsMgUdwbN1k0ev1LKMPgj0MK66X17YUhhB5uzsTgHeMCOFJ0mpiLx9e+pZo34knlTifBtc+ycsmWQ1z3rDI6SYOgxXG71uL0gRgykmmKPZpO/bLyCiR5Z2KYVc3rHQU3HTgOu5yLy6c+9C7v/U9AOEGM+iCK65TpjoWc4zdQQ4gOsC0p6Hpsk+QLjJg6VfLuQSSaGjlOCZgdbKfd/+RFO+uIEn8rUAVSNECMWEZXriX7613t2Saer9fwRPvm2L7DWzgVGkWqQPabumDk3F2xmmFghcCAwEAAaNCMEAwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYEFI/wS3+oLkUkrk1Q+mOai97i3Ru8MA0GCSqGSIb3DQEBCwUAA4IBAQBLQNvAUKr+yAzv95ZURUm7lgAJQayzE4aGKAczymvmdLm6AC2upArT9fHxD4q/c2dKg8dEe3jgr25sbwMpjjM5RcOO5LlXbKr8EpbsU8Yt5CRsuZRj+9xTaGdWPoO4zzUhw8lo/s7awlOqzJCK6fBdRoyV3XpYKBovHd7NADdBj+1EbddTKJd+82cEHhXXipa0095MJ6RMG3NzdvQXmcIfeg7jLQitChws/zyrVQ4PkX4268NXSb7hLi18YIvDQVETI53O9zJrlAGomecsMx86OyXShkDOOyyGeMlhLxS67ttVb9+E7gUJTb0o2HLO02JQZR7rkpeDMdmztcpHWD9f',
  /* GlobalSign Root CA - R6 */ 'MIIFgzCCA2ugAwIBAgIORea7A4Mzw4VlSOb/RVEwDQYJKoZIhvcNAQEMBQAwTDEgMB4GA1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjYxEzARBgNVBAoTCkdsb2JhbFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMTQxMjEwMDAwMDAwWhcNMzQxMjEwMDAwMDAwWjBMMSAwHgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSNjETMBEGA1UEChMKR2xvYmFsU2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAJUH6HPKZvnsFMp7PPcNCPG0RQssgrRIxutbPK6DuEGSMxSkb3/pKszGsIhrxbaJ0cay/xTOURQh7ErdG1rG1ofuTToVBu1kZguSgMpE3nOUTvOniX9PeGMIyBJQbUJmL025eShNUhqKGoC3GYEOfsSKvGRMIRxDaNc9PIrFsmbVkJq3MQbFvuJtMgamHvm566qjuL++gmNQ0PAYid/kD3n16qIfKtJwLnvnvJO7bVPiSHyMEAc4/2ayd2F+4OqMPKq0pPbzlUoSB239jLKJz9CgYXfIWHSw1CM69106yqLbnQneXUQtkPGBzVeS+n68UARjNN9rkxi+azayOeSsJDa38O+2HBNXk7besvjihbdzorg1qkXy4J02oW9UivFyVm4uiMVRQkQVlO6jxTiWm05OWgtH8wY2SXcwvHE35absIQh1/OZhFj931dmRl4QKbNQCTXTAFO39OfuD8l4UoQSwC+n+7o/hbguyCLNhZglqsQY6ZZZZwPA1/cnaKI0aEYdwgQqomnUdnjqGBQCe24DWJfncBZ4nWUx2OVvq+aWh2IMP0f/fMBH5hc8zSPXKbWQULHpYT9NLCEnFlWQaYw55PfWzjMpYrZxCRXluDocZXFSxZba/jJvcE+kNb7gu3GduyYsRtYQUigAZcIN5kZeR1BonvzceMgfYFGM8KEyvAgMBAAGjYzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSubAWjkxPioufi1xzWx/B/yGdToDAfBgNVHSMEGDAWgBSubAWjkxPioufi1xzWx/B/yGdToDANBgkqhkiG9w0BAQwFAAOCAgEAgyXt6NH9lVLNnsAEoJFp5lzQhN7craJP6Ed41mWYqVuoPId8AorRbrcWc+ZfwFSY1XS+wc3iEZGtIxg93eFyRJa0lV7Ae46ZeBZDE1ZXs6KzO7V33EByrKPrmzU+sQghoefEQzd5Mr6155wsTLxDKZmOMNOsIeDjHfrYBzN2VAAiKrlNIC5waNrlU/yDXNOd8v9EDERm8tLjvUYAGm0CuiVdjaExUd1URhxN25mW7xocBFymFe944Hn+Xds+qkxV/ZoVqW/hpvvfcDDpw+5CRu3CkwWJ+n1jez/QcYF8AOiYrg54NMMl+68KnyBr3TsTjxKM4kEaSHpzoHdpx7Zcf4LIHv5YGygrqGytXm3ABdJ7t+uA/iU3/gKbaKxCXcPu9czc8FB10jZpnOZ7BN9uBmm23goJSFmH63sUYHpkqmlD75HHTOwY3WzvUy2MmeFe8nI+z1TIvWfspA9MRf/TuTAjB0yPEL+GltmZWrSZVxykzLsViVO6LAUP5MSeGbEYNNVMnbrt9x+vJJUEeKgDu+6B5dpffItKoZB0JaezPkvILFa9x8jvOOJckvB595yEunQtYQEgfn7R8k8HWV+LLUNS60YMlOH1Zkd5d9VUWx+tJDfLRVpOoERIyNiwmcUVhAn21klJwGW45hpxbqCo8YLoRT5s1gLXCmeDBVrJpBA=',
  /* GlobalSign Root R46 */ 'MIIFWjCCA0KgAwIBAgISEdK7udcjGJ5AXwqdLdDfJWfRMA0GCSqGSIb3DQEBDAUAMEYxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52LXNhMRwwGgYDVQQDExNHbG9iYWxTaWduIFJvb3QgUjQ2MB4XDTE5MDMyMDAwMDAwMFoXDTQ2MDMyMDAwMDAwMFowRjELMAkGA1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExHDAaBgNVBAMTE0dsb2JhbFNpZ24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCsrHQy6LNl5brtQyYdpokNRbopiLKkHWPd08EsCVeJOaFV6Wc0dwxu5FUdUiXSE2te4R2pt32JMl8Nnp8semNgQB+msLZ4j5lUlghYruQGvGIFAha/r6gjA7aUD7xubMLL1aa7DOn2wQL7Id5m3RerdELv8HQvJfTqa1VbkNud316HCkD7rRlr+/fKYIje2sGP1q7Vf9Q8g+7XFkyDRTNrJ9CG0Bwta/OrffGFqfUo0q3v84RLHIf8E6M6cqJaESvWJ3En7YEtbWaBkoe0G1h6zD8K+kZPTXhc+CtI4wSEy132tGqzZfxCnlEmIyDLPRT5ge1lFgBPGmSXZgjPjHvjK8Cd+RTyG/FWaha/LIWFzXg4mutCagI0GIMXTpRW+LaCtfOW3T3zvn8gdz57GSNrLNRyc0NXfeD412lPFzYE+cCQYDdF3uYM2HSNrpyibXRdQr4G9dlkbgIQrImwTDsHTUB+JMWKmIJ5jqSngiCNI/onccnfxkF0oE32kRbcRoxfKWMxWXEM2G/CtjJ9++ZdU6Z+Ffy7dXxd7Pj2Fxzsx2sZy/N78CsHpdlseVR2bJ0cpm4O6XkMqCNqo98bMDGfsVR7/mrLZqrcZdCinkqaByFrgY/bxFn63iLABJzjqls2k+g9vXqhnQt2sQvHnf3PmKgGwvgqo6GDoLclcqUC4wIDAQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUA1yrc4GHqMywptWU4jaWSf8FmSwwDQYJKoZIhvcNAQEMBQADggIBAHx47PYCLLtbfpIrXTncvtgdokIzTfnvpCo7RGkerNlFo048p9gkUbJUHJNOxO97k4VgJuoJSOD1u8fpaNK7ajFxzHmuEajwmf3lH7wvqMxX63bEIaZHU1VNaL8FpO7XJqti2kM3S+LGteWygxk6x9PbTZ4IevPuzz5i+6zoYMzRx6Fcg0XERczzF2sUyQQCPtIkpnnpHs6i58FZFZ8d4kuaPp92CC1r2LpXFNqD6v6MVenQTqnMdzGxRBF6XLE+0xRFFRhiJBPSy03OXIPBNvIQtQ6IbbjhVp+J3pZmOUdkLG5NrmJ7v2B0GbhWrJKsFjLtrWhV/pi60zTe9Mlhww6G9kuEYO4Ne7UyWHmRVSyBQ7N0H3qqJZ4d16GLuc1CLgSkZoNNiTW2bKg2SnkheCLQQrzRQDGQob4Ez8pn7fXwgNNgyYMqIgXQBztSvwyeqiv5u+YfjyW6hY0XHgL+XVAEV8/+LbzvXMAaq7afJMbfc2hIkCwU9D9SGuTSyxTDYWnP4vkYxboznxSjBF25cfe1lNj2M8FawTSLfJvdkzrnE6JwYZ+vj+vYxXX4M2bUdGc6N3ec592kD3ZDZopD8p/7DEJ4Y9HiD2971KE9dJeFt0g5QdYg/NA6s/rob8SKunE3vouXsXgxT7PntgMTzlSdriVZzH81Xwj3QEUxeCp6',
  /* GlobalSign Root E46 */ 'MIICCzCCAZGgAwIBAgISEdK7ujNu1LzmJGjFDYQdmOhDMAoGCCqGSM49BAMDMEYxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52LXNhMRwwGgYDVQQDExNHbG9iYWxTaWduIFJvb3QgRTQ2MB4XDTE5MDMyMDAwMDAwMFoXDTQ2MDMyMDAwMDAwMFowRjELMAkGA1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExHDAaBgNVBAMTE0dsb2JhbFNpZ24gUm9vdCBFNDYwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAScDrHPt+ieUnd1NPqlRqetMhkytAepJ8qUuwzSChDH2omwlwxwEwkBjtjqR+q+soArzfwoDdusvKSGN+1wCAB16pMLey5SnCNoIwZD7JIvU4Tb+0cUB+hflGddyXqBPCCjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBQxCpCPtsad0kRLgLWi5h+xEk8blTAKBggqhkjOPQQDAwNoADBlAjEA31SQ7Zvvi5QCkxeCmb6zniz2C5GMn0oUsfZkvLtoURMMA/cVi4RguYv/Uo7njLwcAjA8+RHUjE7AwWHCFUyqqx0LMV87HOIAl0Qx5v5zli/altP+CAezNIm8BZ/3Hobui3A=',
  /* Amazon Root CA 1 */ 'MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsFADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXjca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qwIFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQmjgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUAA4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDIU5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUsN+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vvo/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpyrqXRfboQnoZsG4q5WTP468SQvvG5',
  /* Amazon Root CA 2 */ 'MIIFQTCCAymgAwIBAgITBmyf0pY1hp8KD+WGePhbJruKNzANBgkqhkiG9w0BAQwFADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSAyMB4XDTE1MDUyNjAwMDAwMFoXDTQwMDUyNjAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgMjCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK2Wny2cSkxKgXlRmeyKy2tgURO8TW0G/LAIjd0ZEGrHJgw12MBvIITplLGbhQPDW9tK6Mj4kHbZW0/jTOgGNk3Mmqw9DJArktQGGWCsN0R5hYGCrVo34A3MnaZMUnbqQ523BNFQ9lXg1dKmSYXpN+nKfq5clU1Imj+uIFptiJXZNLhSGkOQsL9sBbm2eLfq0OQ6PBJTYv9K8nu+NQWpEjTj82R0Yiw9AElaKP4yRLuH3WUnAnE72kr3H9rN9yFVkE8P7K6C4Z9r2UXTu/Bfh+08LDmG2j/e7HJV63mjrdvdfLC6HM783k81ds8P+HgfajZRRidhW+mez/CiVX18JYpvL7TFz4QuK/0NURBs+18bvBt+xa47mAExkv8LV/SasrlX6avvDXbR8O70zoan4G7ptGmh32n2M8ZpLpcTnqWHsFcQgTfJU7O7f/aS0ZzQGPSSbtqDT6ZjmUyl+17vIWR6IF9sZIUVyzfpYgwLKhbcAS4y2j5L9Z469hdAlO+ekQiG+r5jqFoz7Mt0Q5X5bGlSNscpb/xVA1wf+5+9R+vnSUeVC06JIglJ4PVhHvG/LopyboBZ/1c6+XUyo05f7O0oYtlNc/LMgRdg7c3r3NunysV+Ar3yVAhU/bQtCSwXVEqY0VThUWcI0u1ufm8/0i2BWSlmy5A5lREedCf+3euvAgMBAAGjQjBAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBSwDPBMMPQFWAJI/TPlUq9LhONmUjANBgkqhkiG9w0BAQwFAAOCAgEAqqiAjw54o+Ci1M3m9Zh6O+oAA7CXDpO8Wqj2LIxyh6mx/H9z/WNxeKWHWc8w4Q0QshNabYL1auaAn6AFC2jkR2vHat+2/XcycuUY+gn0oJMsXdKMdYV2ZZAMA3m3MSNjrXiDCYZohMr/+c8mmpJ5581LxedhpxfL86kSk5Nrp+gvU5LEYFiwzAJRGFuFjWJZY7attN6a+yb3ACfAXVU3dJnJUH/jWS5E4ywl7uxMMne0nxrpS10gxdr9HIcWxkPo1LsmmkVwXqkLN1PiRnsn/eBG8om3zEK2yygmbtmlyTrIQRNg91CMFa6ybRoVGld45pIq2WWQgj9sAq+uEjonljYE1x2igGOpm/HlurR8FLBOybEfdF849lHqm/osohHUqS0nGkWxr7JOcQ3AWEbWaQbLU8uz/mtBzUF+fUwPfHJ5elnNXkoOrJupmHN5fLT0zLm4BwyydFy4x2+IoZCn9Kr5v2c69BoVYh63n749sSmvZ6ES8lgQGVMDMBu4Gon2nL2XA46jCfMdiyHxtN/kHNGfZQIG6lzWE7OE76KlXIx3KadowGuuQNKotOrN8I1LOJwZmhsoVLiJkO/KdYE+HvJkJMcYr07/R54H9jVlpNMKVv/1F2Rs76giJUmTtt8AF9pYfl3uxRuw0dFfIRDH+fO6AgonB8Xx1sfT4PsJYGw=',
  /* Amazon Root CA 3 */ 'MIIBtjCCAVugAwIBAgITBmyf1XSXNmY/Owua2eiedgPySjAKBggqhkjOPQQDAjA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSAzMB4XDTE1MDUyNjAwMDAwMFoXDTQwMDUyNjAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgMzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABCmXp8ZBf8ANm+gBG1bG8lKlui2yEujSLtf6ycXYqm0fc4E7O5hrOXwzpcVOho6AF2hiRVd9RFgdszflZwjrZt6jQjBAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBSrttvXBp43rDCGB5Fwx5zEGbF4wDAKBggqhkjOPQQDAgNJADBGAiEA4IWSoxe3jfkrBqWTrBqYaGFy+uGh0PsceGCmQ5nFuMQCIQCcAu/xlJyzlvnrxir4tiz+OpAUFteMYyRIHN8wfdVoOw==',
  /* Amazon Root CA 4 */ 'MIIB8jCCAXigAwIBAgITBmyf18G7EEwpQ+Vxe3ssyBrBDjAKBggqhkjOPQQDAzA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSA0MB4XDTE1MDUyNjAwMDAwMFoXDTQwMDUyNjAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgNDB2MBAGByqGSM49AgEGBSuBBAAiA2IABNKrijdPo1MN/sGKe0uoe0ZLY7Bi9i0b2whxIdIA6GO9mif78DluXeo9pcmBqqNbIJhFXRbb/egQbeOc4OO9X4Ri83BkM6DLJC9wuoihKqB1+IGuYgbEgds5bimwHvouXKNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAYYwHQYDVR0OBBYEFNPsxzplbszh2naaVvuc84ZtV+WBMAoGCCqGSM49BAMDA2gAMGUCMDqLIfG9fhGt0O9Yli/W651+kI0rz2ZVwyzjKKlwCkcO8DdZEv8tmZQoTipPNU0zWgIxAOp1AE47xDqUEpHJWEadIRNyp4iciuRMStuW1KyLa2tJElMzrdfkviT8tQp21KW8EA==',
  /* Go Daddy Root Certificate Authority - G2 */ 'MIIDxTCCAq2gAwIBAgIBADANBgkqhkiG9w0BAQsFADCBgzELMAkGA1UEBhMCVVMxEDAOBgNVBAgTB0FyaXpvbmExEzARBgNVBAcTClNjb3R0c2RhbGUxGjAYBgNVBAoTEUdvRGFkZHkuY29tLCBJbmMuMTEwLwYDVQQDEyhHbyBEYWRkeSBSb290IENlcnRpZmljYXRlIEF1dGhvcml0eSAtIEcyMB4XDTA5MDkwMTAwMDAwMFoXDTM3MTIzMTIzNTk1OVowgYMxCzAJBgNVBAYTAlVTMRAwDgYDVQQIEwdBcml6b25hMRMwEQYDVQQHEwpTY290dHNkYWxlMRowGAYDVQQKExFHb0RhZGR5LmNvbSwgSW5jLjExMC8GA1UEAxMoR28gRGFkZHkgUm9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgLSBHMjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL9xYgjx+lk09xvJGKP3gElY6SKDE6bFIEMBO4Tx5oVJnyfq9oQbTqC023CYxzIBsQU+B07u9PpPL1kwIuerGVZr4oAH/PMWdYA5UXvl+TW2dE6pjYIT5LY/qQOD+qK+ihVqf94Lw7YZFAXK6sOoBJQ7RnwyDfMAZiLIjWltNowRGLfTshxgtDj6AozO091GB94KPutdfMh8+7ArU6SSYmlRJQVhGkSBjCypQ5Yj36w6gZoOKcUcqeldHraenjAKOc7xiID7S13MMuyFYkMlNAJWJwGRtDtwKj9useiciAF9n9T521NtYJ2/LOdYq7hfRvzOxBsDPAnrSTFcaUaz4EcCAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFDqahQcQZyi27/a9BUFuIMGU2g/eMA0GCSqGSIb3DQEBCwUAA4IBAQCZ21151fmXWWcDYfF+OwYxdS2hII5PZYe096acvNjpL9DbWu7PdIxztDhC2gV7+AJ1uP2lsdeu9tfeE8tTEH6KRtGX+rcuKxGrkLAngPnon1rpN5+r5N9ss4UXnT3ZJE95kTXWXwTrgIOrmgIttRD02JDHBHNA7XIloKmf7J6raBKZV8aPEjoJpL1E/QYVN8Gb5DKj7Tjo2GTzLH4U/ALqn83/B2gX2yKQOC16jdFU8WnjXzPKej17CuPKf1855eJ1usV2GDPOLPAvTK33sefOT6jEm0pUBsV/fdUID+Ic/n4XuKxe9tQWskMJDE32p2u0mYRlynqI4uJEvlz36hz1',
  /* Starfield Root Certificate Authority - G2 */ 'MIID3TCCAsWgAwIBAgIBADANBgkqhkiG9w0BAQsFADCBjzELMAkGA1UEBhMCVVMxEDAOBgNVBAgTB0FyaXpvbmExEzARBgNVBAcTClNjb3R0c2RhbGUxJTAjBgNVBAoTHFN0YXJmaWVsZCBUZWNobm9sb2dpZXMsIEluYy4xMjAwBgNVBAMTKVN0YXJmaWVsZCBSb290IENlcnRpZmljYXRlIEF1dGhvcml0eSAtIEcyMB4XDTA5MDkwMTAwMDAwMFoXDTM3MTIzMTIzNTk1OVowgY8xCzAJBgNVBAYTAlVTMRAwDgYDVQQIEwdBcml6b25hMRMwEQYDVQQHEwpTY290dHNkYWxlMSUwIwYDVQQKExxTdGFyZmllbGQgVGVjaG5vbG9naWVzLCBJbmMuMTIwMAYDVQQDEylTdGFyZmllbGQgUm9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgLSBHMjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL3twQP89o/8ArFvW59I2Z154qK3A2FWGMNHttfKPTUuiUP3oWmb3ooa/RMgnLRJdzIpVv257IzdIvpy3Cdhl+72WoTsbhm5iSzchFvVdPtrX8WJpRBSiUZV9Lh1HOZ/5FSuS/hVclcCGfgXcVnrHigHdMWdSL5stPSksPNkN3mSwOxGXn/hbVNMYq/NHwtjuzqd+/x5AJhhdM8mgkBj87JyahkNmcrUDnXMN/uLicFZ8WJ/X7NfZTD4p7dNdloedl40wOiWVpmKs/B/pM293DIxfJHP4F8R+GuqSVzRmZTRouNjWwl2tVZi4Ut0HZbUJtQIBFnQmA4O5t78w+wfkPECAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFHwMMh+n2TB/xH1oo2Kooc6rB1snMA0GCSqGSIb3DQEBCwUAA4IBAQARWfolTwNvlJk7mh+ChTnUdgWUXuEok21iXQnCoKjUsHU48TRqneSfioYmUeYs0cYtbpUgSpIB7LiKZ3sx4mcujJUDJi5DnUox9g61DLu34jd/IroAow57UvtruzvE03lRTs2Q9GcHGcg8RnoNAX3FWOdt5oUwF5okxBDgBPfg8n/Uqgr/Qh037ZTlZFkSIHc40zI+OIF1lnP6aI+xy84fxez6nH7PfrHxBy22/L/KpL/QlwVKvOoYKAKQvVR4CSFx09F9HdkWsKlhPdAKACL8x3vLCWRFCztAgfd9fDL1mMpYjn0q7pBZc2T5NnReJaH1ZgUufzkVqSr7UIuOhWn0',
  /* Certum Trusted Network CA */ 'MIIDuzCCAqOgAwIBAgIDBETAMA0GCSqGSIb3DQEBBQUAMH4xCzAJBgNVBAYTAlBMMSIwIAYDVQQKExlVbml6ZXRvIFRlY2hub2xvZ2llcyBTLkEuMScwJQYDVQQLEx5DZXJ0dW0gQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxIjAgBgNVBAMTGUNlcnR1bSBUcnVzdGVkIE5ldHdvcmsgQ0EwHhcNMDgxMDIyMTIwNzM3WhcNMjkxMjMxMTIwNzM3WjB+MQswCQYDVQQGEwJQTDEiMCAGA1UEChMZVW5pemV0byBUZWNobm9sb2dpZXMgUy5BLjEnMCUGA1UECxMeQ2VydHVtIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MSIwIAYDVQQDExlDZXJ0dW0gVHJ1c3RlZCBOZXR3b3JrIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4/t9o3K6wvDJFIf1awFO4W5AB7ptJ11/91sts1rHUV+rpDKmYYe2bg+G0jACl/jXaVehGDldamR5xgFZrDwxSjh80gTSSyjoIF87B6LMTXPb865Px1bVWqeWifrzq2jUI4ZZJ88JJ7ysbnKDHDBy3+Ci6dLhdHUZvSqeexVUBBvXQzmtVSjF4hq79MDkrjhJM8x2hZ85RdKknvISjFH4fOQtf/WsX+sWn7Et0brMkUJ3TCXJkDhv2/DM+44el1k+1WBO5gUo7Ul5E0u6SNsv+XLTOcr+H9g0cvW0QM8xAcPs3hEtF10fuFDRXhmnad4HMyjKUJX5p1TLVIZQRan5SQIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBQIds3LB/8k9sXN7buQvOKEN0Z19zAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQEFBQADggEBAKaorSLOAT2mo/9i0Eidi15ysHhE49wcrwn9I0j6vSrEuVUEtRCjjSfeC4Jj0O7eDDd5QVsisrCaQVymcODU0HfLI9MA4GxWL+FpDQ3Zqr8hgVDZBqWo/5U30Kr+4rP1mS1FhIrlQgnXdAIv94nYmem8J9RHjboNRhx3zxSkHLmkMcScKHQDNP8zGSal6Q10tz6XxnboJ5ajZt3hrvJBW8qYVoNzcOSGGtIxQbovvi0TWnZvTuhOgQ4/WwMioBK+ZlgRSssDxLQqKi2WF+A5VLxI03YnnZotBqbJ7DnSq9ufmgsnAjUpsUCV5/nonFWIGUbWtzT1fs45mtk48VH3Tyw='
].map(function (b) { return '-----BEGIN CERTIFICATE-----\n' + b.replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n'; });

/* ---------- Quick play relay: the hub's audio player cannot read Shoutcast "ICY" answers, some redirects
   or streams whose certificates are newer than the TV's own list. The helper fetches the stream and passes it on
   as plain audio. Certificates are always checked: first against the TV's own list, then against RADIO_ROOTS.
   Only http(s), only for the hub on this TV (127.0.0.1). A stream that sends nothing for 20 s is closed, so the
   hub notices and reconnects instead of sitting silent. ---------- */
var netm = require('net'), tlsm = require('tls'), urlm = require('url');
var radioTls = {};   /* host -> 'roots' once the TV's own list has failed for it */
function radioCertErr(e) { var m = String((e && (e.code || e.message)) || ''); return /CERT|ISSUER|SELF_SIGNED|UNABLE_TO|verify|certificate/i.test(m); }
function radioRelay(u, res, depth, useRoots) {
  var p = urlm.parse(String(u || ''));
  if (!/^https?:$/.test(p.protocol || '') || !p.hostname || depth > 4) { res.statusCode = 400; res.end(); return; }
  var secure = p.protocol === 'https:', port = +p.port || (secure ? 443 : 80), path = p.path || '/';
  if (secure && radioTls[p.hostname] === 'roots') { useRoots = true; }
  var opts = { host: p.hostname, port: port, servername: p.hostname };
  if (useRoots) { opts.ca = RADIO_ROOTS; }
  var sock = secure ? tlsm.connect(opts) : netm.connect({ host: p.hostname, port: port });
  var chunks = [], got = 0, passing = false, finished = false;
  function fail(code) { if (finished) { return; } finished = true; try { sock.destroy(); } catch (e) { /* ignore */ } if (!res.headersSent) { res.statusCode = code; res.end(); } else { try { res.end(); } catch (e2) { /* ignore */ } } }
  try { sock.setKeepAlive(true, 10000); } catch (e) { /* ignore */ }
  sock.setTimeout(15000, function () { fail(504); });
  sock.on(secure ? 'secureConnect' : 'connect', function () {
    sock.write('GET ' + path + ' HTTP/1.0\r\nHost: ' + p.host + '\r\nUser-Agent: GreenwoodHub/' + VERSION + '\r\nAccept: */*\r\nIcy-MetaData: 0\r\nConnection: close\r\n\r\n');
  });
  sock.on('data', function (d) {
    if (passing) { return; }
    chunks.push(d); got += d.length;
    var buf = Buffer.concat(chunks), txt = buf.toString('binary'), end = txt.indexOf('\r\n\r\n');
    if (end < 0) { if (got > 16384) { fail(502); } return; }
    var head = txt.slice(0, end), st = /^(?:HTTP\/1\.[01]|ICY) (\d{3})/.exec(head), code = st ? +st[1] : 0;
    var hv = function (n) { var m = new RegExp('^' + n + ':\\s*(.+)$', 'im').exec(head); return m ? m[1].trim() : ''; };
    if (code >= 300 && code < 400 && hv('location')) {
      finished = true; sock.destroy();
      radioRelay(urlm.resolve(u, hv('location')), res, depth + 1);
      return;
    }
    if (code !== 200) { fail(502); return; }
    passing = true;
    sock.setTimeout(20000, function () { fail(504); });   /* stream went quiet: close so the hub reconnects */
    var ct = (hv('content-type') || 'audio/mpeg').split(';')[0].trim().toLowerCase();
    if (ct === 'audio/aacp' || ct === 'audio/x-aac') { ct = 'audio/aac'; }
    if (!/^audio\/|^application\/ogg/.test(ct)) { ct = 'audio/mpeg'; }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.write(buf.slice(end + 4));
    sock.pipe(res);
  });
  sock.on('error', function (e) {
    if (secure && !useRoots && !passing && !finished && radioCertErr(e)) {
      finished = true; radioTls[p.hostname] = 'roots'; try { sock.destroy(); } catch (e2) { /* ignore */ }
      radioRelay(u, res, depth, true);
      return;
    }
    fail(502);
  });
  sock.on('end', function () { if (!passing) { fail(502); } else { fail(200); } });
  res.on('close', function () { finished = true; try { sock.destroy(); } catch (e) { /* ignore */ } });
}

/* ---------- Wi-Fi QR for the iPhone card ---------- */
function wifiEsc(v) { return String(v).replace(/([\\;,:"])/g, '\\$1'); }
function wifiSsid(cb) {
  var done = false;
  function fin(v) { if (!done) { done = true; cb(v); } }
  setTimeout(function () { fin(null); }, 1500);
  try { tizen.systeminfo.getPropertyValue('WIFI_NETWORK', function (w) { fin(w && w.status === 'ON' ? w.ssid : null); }, function () { fin(null); }); } catch (e) { fin(null); }
}
function wifiInfo(cb) {
  wifiSsid(function (ssid) {
    var w = readCfg().wifi || null, out = { ok: true, ssid: ssid || (w ? w.ssid : null), qr: null };
    if (w && w.pass && out.ssid && (!ssid || ssid === w.ssid)) {
      out.qr = 'WIFI:T:' + (w.type || 'WPA') + ';S:' + wifiEsc(out.ssid) + ';P:' + wifiEsc(w.pass) + ';;';
    }
    cb(out);
  });
}

/* ---------- One-time calendar setup (code on the TV, links from the laptop) ---------- */
var setup = { pin: '', until: 0, tries: 0, server: null, done: false, count: 0, timer: null };
var ICS_RE = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[A-Za-z0-9%._@+\-]+\/(private-[0-9a-f]+|public)\/basic\.ics$/;

function stopSetup() {
  clearTimeout(setup.timer);
  if (setup.server) { try { setup.server.close(); } catch (e) { /* ignore */ } }
  setup.server = null; setup.pin = ''; setup.until = 0;
}

function startSetup() {
  stopSetup();
  var n = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  setup.pin = ('000000' + n).slice(-6);
  setup.until = Date.now() + 10 * 60000;
  setup.tries = 0; setup.done = false; setup.count = 0;
  setup.server = http.createServer(function (req, res) {
    if (req.method === 'GET' && req.url === '/ssid') {
      res.setHeader('Content-Type', 'application/json');
      wifiSsid(function (ssid) { res.end(JSON.stringify({ ssid: ssid || '' })); });
      return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(SETUP_PAGE);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/setup') { res.statusCode = 404; res.end('{"ok":false}'); return; }
    if (!setup.pin || Date.now() > setup.until) { res.statusCode = 410; res.end('{"ok":false,"error":"setup closed"}'); return; }
    var body = '', tooBig = false;
    req.on('data', function (c) { body += c; if (body.length > 16384) { tooBig = true; req.destroy(); } });
    req.on('end', function () {
      if (tooBig) { return; }
      var data = null;
      try { data = JSON.parse(body); } catch (e) { data = null; }
      if (!data || String(data.pin) !== setup.pin) {
        setup.tries++;
        if (setup.tries >= 5) { stopSetup(); }
        res.statusCode = 403; res.end('{"ok":false,"error":"wrong code"}'); return;
      }
      var list = (data.calendars || []).slice(0, 4).map(function (c) {
        return { url: String(c.url || '').trim(), label: String(c.label || 'Calendar').replace(/[^\w À-ɏ+&-]/g, '').slice(0, 24) };
      });
      var bad = list.filter(function (c) { return !ICS_RE.test(c.url); });
      var wifi = data.wifi && data.wifi.pass ? { ssid: String(data.wifi.ssid || '').slice(0, 32), pass: String(data.wifi.pass).slice(0, 63), type: 'WPA' } : null;
      if (wifi && (!wifi.ssid || wifi.pass.length < 8)) { res.statusCode = 400; res.end('{"ok":false,"error":"Wi-Fi name and a password of 8 or more characters are needed"}'); return; }
      if ((!list.length && !wifi) || bad.length) { res.statusCode = 400; res.end('{"ok":false,"error":"only Google Calendar iCal links are accepted"}'); return; }
      var cfg = readCfg();
      if (list.length) { cfg.calendars = list; }
      if (wifi) { cfg.wifi = wifi; }
      if (!writeCfg(cfg)) { res.statusCode = 500; res.end('{"ok":false,"error":"could not save"}'); return; }
      calCache.at = 0; calCache.events = [];
      setup.done = true; setup.count = list.length;
      res.end(JSON.stringify({ ok: true, count: list.length, wifi: !!wifi }));
      setTimeout(stopSetup, 1500);
    });
  });
  setup.server.on('error', function () { stopSetup(); setup.error = 'listen failed'; });
  setup.server.listen(SETUP_PORT, '0.0.0.0');
  setup.timer = setTimeout(stopSetup, 10 * 60000);
  setup.error = '';
  return setup.pin;
}


/* Page shown on a phone or laptop at http://<TV IP>:8096 while the code is on the TV. No outside files. */
var SETUP_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Greenwood TV · Calendars</title><style>' +
  'body{margin:0;background:#012B28;color:#F4F2EC;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
  '.w{max-width:560px;margin:0 auto;padding:28px 18px 40px}h1{font:600 30px/1.2 Georgia,serif;margin:0 0 6px}' +
  'p{color:#A9BDB7;margin:0 0 18px}label{display:block;font-weight:700;margin:18px 0 6px}' +
  'small{display:block;color:#A9BDB7;font-weight:400;margin-top:2px}' +
  'input{box-sizing:border-box;width:100%;padding:13px 14px;border-radius:12px;border:1px solid #2F5A54;background:#0B3A35;color:#F4F2EC;font-size:16px}' +
  'input:focus{outline:2px solid #EBB42C;border-color:#EBB42C}.row{display:flex}.row input:first-child{flex:0 0 34%;margin-right:8px}' +
  'button{margin-top:26px;width:100%;padding:15px;border:0;border-radius:999px;background:#EBB42C;color:#012B28;font-size:17px;font-weight:800}' +
  '#m{margin-top:18px;font-weight:700}.ok{color:#7CC4A4}.bad{color:#E8A15A}details{margin-top:28px;color:#A9BDB7}summary{cursor:pointer;color:#F4F2EC}' +
  'ol{padding-left:20px}li{margin:4px 0}</style></head><body><div class="w">' +
  '<h1>Connect calendars</h1><p>Greenwood TV shows meeting times and titles. The links stay on the TV only.</p>' +
  '<label>Code on the TV</label><input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456">' +
  '<label>Calendar 1<small>Name, then its secret iCal address</small></label><div class="row"><input id="l1" value="Personal"><input id="u1" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></div>' +
  '<label>Calendar 2 <small>Optional</small></label><div class="row"><input id="l2" value="Aerones"><input id="u2" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></div>' +
  '<label>Home Wi-Fi <small>Optional. For the QR code on the TV&#39;s iPhone card. The password stays on the TV only.</small></label>' +
  '<div class="row"><input id="ws" placeholder="Network name"><input id="wp" type="password" autocomplete="off" placeholder="Wi-Fi password"></div>' +
  '<button id="b">Send to TV</button><div id="m"></div>' +
  '<details><summary>Where do I find the secret iCal address?</summary><ol>' +
  '<li>On a computer, open calendar.google.com.</li><li>Left side: hover the calendar → ⋮ → <b>Settings and sharing</b>.</li>' +
  '<li>Scroll to <b>Integrate calendar</b> → <b>Secret address in iCal format</b> → copy.</li>' +
  '<li>Do the same in the other Google account (Aerones). If that field is missing, the company has switched it off.</li></ol></details>' +
  '</div><script>' +
  'var b=document.getElementById("b"),m=document.getElementById("m");function v(i){return document.getElementById(i).value.trim();}' +
  'b.onclick=function(){var c=[];if(v("u1"))c.push({label:v("l1")||"Calendar 1",url:v("u1")});if(v("u2"))c.push({label:v("l2")||"Calendar 2",url:v("u2")});' +
  'var w=v("wp")?{ssid:v("ws"),pass:document.getElementById("wp").value}:null;if(!c.length&&!w){m.className="bad";m.textContent="Paste a calendar link or a Wi-Fi password.";return;}b.disabled=true;m.className="";m.textContent="Sending…";' +
  'var x=new XMLHttpRequest();x.open("POST","/setup");x.setRequestHeader("Content-Type","application/json");' +
  'x.onload=function(){var r={};try{r=JSON.parse(x.responseText);}catch(e){}if(r.ok){m.className="ok";m.textContent="Done ✓ "+r.count+" calendar(s) saved. You can close this page.";}' +
  'else{b.disabled=false;m.className="bad";m.textContent=r.error||"Did not work. Check the code and links.";}};' +
  'x.onerror=function(){b.disabled=false;m.className="bad";m.textContent="TV not reachable. Is the code still on the TV?";};' +
  'x.send(JSON.stringify({pin:v("pin").replace(/\\D/g,""),calendars:c,wifi:w}));};' +
  'var ss=new XMLHttpRequest();ss.open("GET","/ssid");ss.onload=function(){try{var r=JSON.parse(ss.responseText);if(r.ssid&&!v("ws"))document.getElementById("ws").value=r.ssid;}catch(e){}};ss.send();</script></body></html>';

/* ---------- Sleep timer ---------- */
var sleep = { endsAt: 0, timer: null };
function setSleep(min) { setSleepUntil(min ? Date.now() + min * 60000 : 0); }
function setSleepUntil(ts) {
  clearTimeout(sleep.timer);
  sleep.endsAt = 0;
  if (!ts || ts <= Date.now()) { return; }
  sleep.endsAt = ts;
  sleep.timer = setTimeout(function () {
    if (retired) { return; }
    sleep.endsAt = 0;
    /* only switch off if the TV is still on (KEY_POWER would otherwise switch it on) */
    http.get('http://127.0.0.1:8001/api/v2/', function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () {
        var on = false;
        try { on = JSON.parse(b).device.PowerState === 'on'; } catch (e) { on = false; }
        log('sleep timer fired, TV ' + (on ? 'on -> KEY_POWER' : 'not on -> nothing'));
        if (on) { sleepPowerOff(0); }
      });
    }).on('error', function () { log('sleep timer: status page not reachable, nothing sent'); });
  }, ts - Date.now());
}

/* Switch off, then confirm on the status page; if the TV still reports "on", try the other route (max 3 tries). */
function powerState(cb) {
  http.get('http://127.0.0.1:8001/api/v2/', function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () { var st = ''; try { st = JSON.parse(b).device.PowerState || ''; } catch (e) { st = ''; } cb(st); });
  }).on('error', function () { cb(''); });
}
function sleepPowerOff(attempt) {
  var host = attempt === 1 ? (lanIp() || '127.0.0.1') : '127.0.0.1';
  queue.push({ key: 'KEY_POWER', host: attempt ? host : '', res: { end: function (j) { log('sleep KEY_POWER try ' + (attempt + 1) + ': ' + j); } } });
  next();
  setTimeout(function () {
    powerState(function (st) {
      log('sleep check after try ' + (attempt + 1) + ': PowerState ' + (st || 'unknown'));
      if (st === 'on' && attempt < 2) { sleepPowerOff(attempt + 1); }
    });
  }, 12000);
}

/* ---------- Status ---------- */
function lanIp() {
  var nets = os.networkInterfaces(), ip = '';
  Object.keys(nets).forEach(function (k) {
    (nets[k] || []).forEach(function (n) { if (!ip && n.family === 'IPv4' && !n.internal) { ip = n.address; } });
  });
  return ip;
}
function status(cb0) {
  var sent = false;
  function cb(o) { if (!sent) { sent = true; cb0(o); } }
  setTimeout(function () { cb(out); }, 1500);
  var cfg = readCfg();
  var out = {
    ok: true, version: VERSION, uptimeMin: Math.round((Date.now() - STARTED) / 60000), ip: lanIp(),
    lastKey: LOG.length ? LOG[LOG.length - 1] : '', token: !!readToken(),
    calendars: (cfg.calendars || []).map(function (c) { return c.label; }),
    calendarAt: calCache.at, calendarErrors: calCache.errors, sleepEndsAt: sleep.endsAt, storage: null,
    module: currentModule(), previous: cfg.prevTag || '', keyHost: keyHost, appsFrom: appCache.source || '',
    keyLog: LOG.filter(function (l) { return / KEY_| sleep/.test(l); }).slice(-3)
  };
  try {
    tizen.systeminfo.getPropertyValue('STORAGE', function (s) {
      try {
        var u = s.units[0];
        out.storage = { free: u.availableCapacity, total: u.capacity };
      } catch (e) { out.storage = null; }
      cb(out);
    }, function () { cb(out); });
  } catch (e) { cb(out); }
}


/* ---------- TV info and stats ---------- */
var cpuLast = null;
function readCpu() {
  try {
    var line = String(fs.readFileSync('/proc/stat', 'utf8')).split('\n')[0].split(/\s+/).slice(1).map(Number);
    var idle = line[3] + (line[4] || 0), total = 0;
    for (var i = 0; i < line.length; i++) { total += line[i] || 0; }
    var prev = cpuLast; cpuLast = { idle: idle, total: total };
    if (!prev || total <= prev.total) { return null; }
    return Math.max(0, Math.min(1, 1 - (idle - prev.idle) / (total - prev.total)));
  } catch (e) { return null; }
}
function readMem() {
  try {
    var txt = String(fs.readFileSync('/proc/meminfo', 'utf8')), m = {};
    txt.split('\n').forEach(function (l) { var p = /^(\w+):\s+(\d+)/.exec(l); if (p) { m[p[1]] = +p[2] * 1024; } });
    var avail = m.MemAvailable || (m.MemFree + (m.Buffers || 0) + (m.Cached || 0));
    return m.MemTotal ? { total: m.MemTotal, avail: avail } : null;
  } catch (e) { return null; }
}
function sysProp(name, pick, cb) {
  var done = false;
  function fin(v) { if (!done) { done = true; cb(v); } }
  setTimeout(function () { fin(null); }, 1500);
  try { tizen.systeminfo.getPropertyValue(name, function (p) { try { fin(pick(p)); } catch (e) { fin(null); } }, function () { fin(null); }); } catch (e) { fin(null); }
}
function stats(cb) {
  var out = { ok: true, cpu: readCpu(), mem: readMem(), storage: null };
  sysProp('STORAGE', function (s) { return { free: s.units[0].availableCapacity, total: s.units[0].capacity }; }, function (v) { out.storage = v; cb(out); });
}
function info(cb) {
  var out = { ok: true, model: null, platform: null, width: null, height: null, ssid: null };
  try { out.platform = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) { out.platform = null; }
  sysProp('BUILD', function (b) { return b.model; }, function (model) {
    out.model = model;
    sysProp('DISPLAY', function (d) { return [d.resolutionWidth, d.resolutionHeight]; }, function (wh) {
      if (wh) { out.width = wh[0]; out.height = wh[1]; }
      sysProp('WIFI_NETWORK', function (w) { return w.status === 'ON' ? w.ssid : null; }, function (ssid) { out.ssid = ssid; cb(out); });
    });
  });
}

/* ---------- Updates: Ričards presses "Install" in About; the hub switches TizenBrew to the new tag ---------- */
function verNum(v) {
  var m = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(v || ''));
  return m ? (+m[1]) * 1000000 + (+m[2]) * 1000 + (+m[3]) : -1;
}
function readTb() { try { return JSON.parse(String(fs.readFileSync(TB_CFG, 'utf8'))); } catch (e) { return null; } }
function currentModule() {
  var c = readTb();
  if (!c || !c.modules) { return ''; }
  for (var i = 0; i < c.modules.length; i++) { if (MOD_RE.test(c.modules[i])) { return c.modules[i]; } }
  return '';
}
function getJson(url, cb) {
  var done = false;
  function finish(err, data) { if (!done) { done = true; cb(err, data); } }
  try {
    var opts = require('url').parse(url);
    opts.headers = { 'User-Agent': 'greenwood-tv-hub/' + VERSION, 'Accept': 'application/json' };
    var req = https.get(opts, function (res) {
      if (res.statusCode !== 200) { res.resume(); finish('HTTP ' + res.statusCode); return; }
      var b = '';
      res.on('data', function (c) { b += c; if (b.length > 512 * 1024) { req.abort(); finish('too large'); } });
      res.on('end', function () { try { finish(null, JSON.parse(b)); } catch (e) { finish('bad json'); } });
    });
    req.setTimeout(15000, function () { req.abort(); finish('timeout'); });
    req.on('error', function (e) { finish((e && e.code) || 'network'); });
  } catch (e) { finish('request error'); }
}
var upd = { at: 0, latest: '', error: '' };
function checkUpdate(force, cb) {
  if (!force && Date.now() - upd.at < 3 * 3600000 && upd.at) { cb(); return; }
  getJson('https://api.github.com/repos/' + REPO + '/tags?per_page=30', function (err, tags) {
    var best = '';
    if (!err && tags && tags.length) {
      tags.forEach(function (t) { var n = t && t.name; if (verNum(n) > verNum(best)) { best = n; } });
      upd = { at: Date.now(), latest: best, error: '' };
      cb(); return;
    }
    /* fallback: jsDelivr's list (versions without the "v") */
    getJson('https://data.jsdelivr.com/v1/packages/gh/' + REPO, function (err2, d) {
      if (!err2 && d && d.versions) {
        d.versions.forEach(function (x) { if (verNum(x.version) > verNum(best)) { best = 'v' + x.version; } });
        upd = { at: Date.now(), latest: best, error: '' };
      } else { upd.error = err || err2 || 'no answer'; upd.at = Date.now(); }
      cb();
    });
  });
}
/* Ask TizenBrew (local socket 127.0.0.1:8081) to start the service of another module version. */
function tbStartService(fullName, cb) {
  var done = false, upgraded = false, buf = new Buffer(0);
  function finish(err) { if (!done) { done = true; try { sock.end(); } catch (e) { /* ignore */ } cb(err); } }
  var sock = net.connect({ host: '127.0.0.1', port: 8081 }, function () {
    sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:8081\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    if (upgraded) { return; }
    buf = Buffer.concat([buf, chunk]);
    var s0 = buf.toString('binary');
    if (s0.indexOf('\r\n\r\n') < 0) { return; }
    if (s0.indexOf(' 101') < 0) { finish('handshake'); return; }
    upgraded = true;
    sock.write(frame(JSON.stringify({ type: 6 /* Events.StartService */, payload: { fullName: fullName, name: fullName.replace(/^gh\//, ''), serviceFile: 'service.js', packageType: 'app' } })));
    setTimeout(function () { finish(null); }, 600);
  });
  sock.on('error', function () { finish('socket'); });
  setTimeout(function () { finish('timeout'); }, 8000);
}
function applyUpdate(tag, res) {
  if (!/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag)) { res.end('{"ok":false,"error":"bad version"}'); return; }
  var full = 'gh/' + REPO + '@' + tag;
  /* the release must be a real Greenwood Hub package before TizenBrew is pointed at it */
  getJson('https://cdn.jsdelivr.net/' + full + '/package.json', function (err, pk) {
    if (err || !pk || pk.packageType !== 'app' || pk.serviceFile !== 'service.js' || pk.version !== tag.slice(1)) {
      res.end(JSON.stringify({ ok: false, error: 'release not ready (' + (err || 'package.json') + ')' })); return;
    }
    var c = readTb();
    if (!c || !c.modules || !c.modules.length) { res.end('{"ok":false,"error":"TizenBrew settings not readable"}'); return; }
    var old = currentModule();
    try { fs.writeFileSync(TB_BACKUP, JSON.stringify(c, null, 4)); } catch (e) { res.end('{"ok":false,"error":"backup failed"}'); return; }
    var mods = [], placed = false;
    c.modules.forEach(function (m) {
      if (MOD_RE.test(m)) { if (!placed) { mods.push(full); placed = true; } }
      else { mods.push(m); }
    });
    if (!placed) { mods.push(full); }
    c.modules = mods;
    if (!c.autoLaunchModule || MOD_RE.test(c.autoLaunchModule)) { c.autoLaunchModule = full; }
    try {
      fs.writeFileSync(TB_CFG + '.tmp', JSON.stringify(c, null, 4));
      JSON.parse(String(fs.readFileSync(TB_CFG + '.tmp', 'utf8')));
      fs.renameSync(TB_CFG + '.tmp', TB_CFG);
    } catch (e) { res.end('{"ok":false,"error":"could not save TizenBrew settings"}'); return; }
    var cfg = readCfg();
    var oldTag = old.indexOf('@') > 0 ? old.slice(old.indexOf('@') + 1) : '';
    if (oldTag && oldTag !== tag) { cfg.prevTag = oldTag; }
    cfg.pendingVersion = tag.slice(1);
    writeCfg(cfg);
    log('update: TizenBrew now points to ' + full + (oldTag ? ' (was ' + oldTag + ')' : ''));
    /* answer first: starting the new helper closes this one's connections */
    res.end(JSON.stringify({ ok: true, module: full,
      appPath: 'http://127.0.0.1:8081/module/' + encodeURIComponent(full) + '/app/index.html' }));
    setTimeout(function () {
      tbStartService(full, function (e) { if (e) { log('update: start new helper: ' + e); } });
    }, 500);
  });
}
/* A newer (or the chosen) version asks this one to step back and free the ports. */
function handoff(v, res) {
  var cfg = readCfg();
  var ok = v !== VERSION && (verNum(v) > verNum(VERSION) || v === cfg.pendingVersion);
  if (!ok) { res.end('{"ok":false}'); return; }
  res.end(JSON.stringify({ ok: true, sleepEndsAt: sleep.endsAt }));
  log('handoff to ' + v);
  retired = true;
  clearTimeout(sleep.timer);
  stopSetup();
  setTimeout(function () {
    try { server.close(); } catch (e) { /* ignore */ }
    /* the page keeps idle keep-alive connections; close them so its next request reaches the new helper */
    openSockets.forEach(function (sk) { try { sk.destroy(); } catch (e) { /* ignore */ } });
    openSockets = [];
  }, 200);
  /* TizenBrew keeps a service it started once; if Ričards later picks this version again
     (rollback), it is not started a second time, so wake up when chosen. */
  clearInterval(reviveTimer);
  reviveTimer = setInterval(function () {
    if (readCfg().pendingVersion === VERSION) { clearInterval(reviveTimer); retired = false; listenTries = 0; log('chosen again, taking over'); listenMain(); }
  }, 4000);
}
var reviveTimer = null;

var LOG = [];
function log(line) {
  LOG.push(new Date().toISOString().slice(11, 19) + ' ' + line);
  if (LOG.length > 20) { LOG.shift(); }
}

/* One retry: after the first "Allow" the TV may close the socket before answering. */
/* Then the TV's own network address: the laptop test showed the remote channel works over the LAN. */
var keyHost = '';
function sendKeyRetry(key, cb) {
  function viaLan(err0, last0) {
    var ip = lanIp();
    if (!ip) { cb(err0, last0); return; }
    sendKey(key, function (err2, last2) {
      if (!err2) { keyHost = ip; }
      cb(err2, last2);
    }, ip);
  }
  if (keyHost) { sendKey(key, function (e, l) { if (e && e !== 'timeout') { keyHost = ''; sendKeyRetry(key, cb); } else { cb(e, l); } }, keyHost); return; }
  sendKey(key, function (err, last) {
    if (err === 'closed' || err === 'error' || err === 'handshake') {
      setTimeout(function () {
        sendKey(key, function (err1, last1) {
          if (err1 && err1 !== 'timeout') { viaLan(err1, last1); } else { cb(err1, last1); }
        });
      }, 800);
    } else if (err === 'denied') { viaLan(err, last); }
    else { cb(err, last); }
  });
}

var queue = [];
var busy = false;
function next() {
  if (busy || !queue.length) { return; }
  busy = true;
  var job = queue.shift();
  var send = job.host ? function (k, cb) { sendKey(k, cb, job.host); } : sendKeyRetry;
  send(job.key, function (err, last) {
    busy = false;
    job.res.end(JSON.stringify(err ? { ok: false, error: err, detail: last } : { ok: true }));
    next();
  });
}
var server = http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (retired) { res.setHeader('Connection', 'close'); }
  res.setHeader('Content-Type', 'application/json');
  var url = req.url || '';
  if (req.method === 'GET' && url === '/apps') {
    readApps(function (err, list) { res.end(JSON.stringify(err ? { ok: false, error: err } : { ok: true, apps: list })); });
    return;
  }
  var ic = /^\/icon\?id=([A-Za-z0-9._]+)$/.exec(url);
  if (req.method === 'GET' && ic) {
    if (appCache.list.length) { sendIcon(ic[1], res); }
    else { readApps(function () { sendIcon(ic[1], res); }); }
    return;
  }
  if (req.method === 'GET' && url === '/status') { status(function (o) { res.end(JSON.stringify(o)); }); return; }
  if (req.method === 'GET' && url === '/stats') { stats(function (o) { res.end(JSON.stringify(o)); }); return; }
  if (req.method === 'GET' && url === '/info') { info(function (o) { res.end(JSON.stringify(o)); }); return; }
  var rq = /^\/radio\?u=(.+)$/.exec(url);
  if (req.method === 'GET' && rq) { var ru = ''; try { ru = decodeURIComponent(rq[1]); } catch (e) { ru = ''; } radioRelay(ru, res, 0); return; }
  if (req.method === 'GET' && url === '/wifi') { wifiInfo(function (o) { res.end(JSON.stringify(o)); }); return; }
  var cm = /^\/calendar(\?force=1)?$/.exec(url);
  if (req.method === 'GET' && cm) { readCalendar(!!cm[1], function (o) { res.end(JSON.stringify(o)); }); return; }
  if (req.method === 'GET' && url === '/setup/start') {
    var pin = startSetup();
    res.end(JSON.stringify({ ok: true, pin: pin, until: setup.until, ip: lanIp(), port: SETUP_PORT }));
    return;
  }
  if (req.method === 'GET' && url === '/setup/status') {
    res.end(JSON.stringify({ ok: true, active: !!setup.pin, done: setup.done, count: setup.count, error: setup.error || '' }));
    return;
  }
  if (req.method === 'GET' && url === '/setup/stop') { stopSetup(); res.end('{"ok":true}'); return; }
  if (req.method === 'GET' && url === '/setup/forget') {
    var c0 = readCfg(); delete c0.calendars; writeCfg(c0); calCache.at = 0; calCache.events = [];
    res.end('{"ok":true}'); return;
  }
  var sl = /^\/sleep(?:\?min=(\d{1,3}))?$/.exec(url);
  if (req.method === 'GET' && sl) {
    if (sl[1] !== undefined) {
      var mins = +sl[1];
      if ([0, 15, 30, 45, 60, 90, 120].indexOf(mins) < 0) { res.statusCode = 400; res.end('{"ok":false,"error":"not allowed"}'); return; }
      setSleep(mins);
    }
    res.end(JSON.stringify({ ok: true, endsAt: sleep.endsAt }));
    return;
  }
  var ho = /^\/handoff\?v=([0-9.]{5,11})$/.exec(url);
  if (req.method === 'GET' && ho) { handoff(ho[1], res); return; }
  var uc = /^\/update\/check(\?force=1)?$/.exec(url);
  if (req.method === 'GET' && uc) {
    checkUpdate(!!uc[1], function () {
      var cfg = readCfg();
      res.end(JSON.stringify({ ok: !upd.error, error: upd.error, current: VERSION, latest: upd.latest,
        newer: verNum(upd.latest) > verNum(VERSION), previous: cfg.prevTag && cfg.prevTag !== 'v' + VERSION ? cfg.prevTag : '', module: currentModule() }));
    });
    return;
  }
  var ua = /^\/update\/apply\?tag=(v[0-9.]{5,11})$/.exec(url);
  if (req.method === 'GET' && ua) { applyUpdate(ua[1], res); return; }
  if (req.method === 'GET' && url === '/log') { res.end(JSON.stringify({ ok: true, log: LOG })); return; }
  var la = /^\/launch\?id=([A-Za-z0-9._]+)$/.exec(url);
  if (req.method === 'GET' && la) { launch(la[1], res); return; }
  var m = /^\/key\?k=([A-Z0-9_]+)$/.exec(url);
  if (req.method !== 'GET' || !m) { res.statusCode = 404; res.end('{"ok":false,"error":"not found"}'); return; }
  var key = m[1];
  if (ALLOWED.indexOf(key) < 0) { res.statusCode = 403; res.end('{"ok":false,"error":"not allowed"}'); return; }
  if (queue.length >= 3) { res.end('{"ok":false,"error":"busy"}'); return; }
  queue.push({ key: key, res: res });
  next();
});
/* Port 8095 may still be held by an earlier copy of the hub (same or older version).
   A newer copy asks the older one to step back; same version: keep the running one. Never crash TizenBrew. */
var openSockets = [];
server.on('connection', function (sk) {
  openSockets.push(sk);
  sk.on('close', function () { var i = openSockets.indexOf(sk); if (i >= 0) { openSockets.splice(i, 1); } });
});
var listenTries = 0;
function listenMain() { if (!retired) { server.listen(PORT, '127.0.0.1'); } }
server.on('listening', function () {
  log('helper ' + VERSION + ' listening');
  var cfg = readCfg();
  if (cfg.pendingVersion === VERSION) { delete cfg.pendingVersion; writeCfg(cfg); }
});
server.on('error', function (e) {
  if (!e || e.code !== 'EADDRINUSE' || retired) { return; }
  listenTries++;
  http.get('http://127.0.0.1:' + PORT + '/handoff?v=' + VERSION, function (r) {
    var b = '';
    r.on('data', function (c) { b += c; });
    r.on('end', function () {
      var d = null;
      try { d = JSON.parse(b); } catch (x) { d = null; }
      if (d && d.ok) { if (d.sleepEndsAt) { setSleepUntil(d.sleepEndsAt); } setTimeout(listenMain, 900); }
      else if (d && d.version === undefined && listenTries < 3) { setTimeout(listenMain, 3000); }
      else { setTimeout(listenMain, listenTries < 10 ? 5000 : 60000); }
    });
  }).on('error', function () { setTimeout(listenMain, 3000); });
});
listenMain();

/* First start of a newly installed version: remove older Greenwood Hub entries from TizenBrew's module list
   and point autolaunch here if it pointed at an older Greenwood Hub. Other modules are never touched. */
setTimeout(function () {
  if (retired) { return; }
  var c = readTb();
  if (!c || !c.modules) { return; }
  var own = -1, newer = false;
  c.modules.forEach(function (m, i) {
    if (!MOD_RE.test(m)) { return; }
    var tag = m.indexOf('@') > 0 ? m.slice(m.indexOf('@') + 1) : '';
    if (verNum(tag) === verNum(VERSION)) { own = i; }
    else if (verNum(tag) > verNum(VERSION)) { newer = true; }
  });
  if (own < 0 || newer) { return; }
  var ownName = c.modules[own];
  var mods = c.modules.filter(function (m) { return !MOD_RE.test(m) || m === ownName; });
  var auto = c.autoLaunchModule && MOD_RE.test(c.autoLaunchModule) && c.autoLaunchModule !== ownName;
  if (mods.length === c.modules.length && !auto) { return; }
  try {
    fs.writeFileSync(TB_BACKUP, JSON.stringify(c, null, 4));
    var oldTags = c.modules.filter(function (m) { return MOD_RE.test(m) && m !== ownName; });
    c.modules = mods;
    if (auto) { c.autoLaunchModule = ownName; }
    fs.writeFileSync(TB_CFG + '.tmp', JSON.stringify(c, null, 4));
    JSON.parse(String(fs.readFileSync(TB_CFG + '.tmp', 'utf8')));
    fs.renameSync(TB_CFG + '.tmp', TB_CFG);
    var cfg = readCfg();
    if (oldTags.length) { var t0 = oldTags[oldTags.length - 1]; cfg.prevTag = t0.slice(t0.indexOf('@') + 1); writeCfg(cfg); }
    log('tidy: kept ' + ownName + ', removed ' + oldTags.length + ' older entr' + (oldTags.length === 1 ? 'y' : 'ies') + (auto ? ', autolaunch updated' : ''));
  } catch (e) { log('tidy failed: ' + ((e && e.message) || e)); }
}, 4000);
