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

var VERSION = '0.5.2';
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
var ALLOWED = ['KEY_HDMI1', 'KEY_HDMI2', 'KEY_HDMI3', 'KEY_MENU', 'KEY_SOURCE', 'KEY_HOME'];
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

function readApps(cb) {
  if (Date.now() - appCache.at < 60000 && appCache.list.length) { cb(null, appCache.list); return; }
  if (typeof tizen === 'undefined' || !tizen.application || !tizen.application.getAppsInfo) { cb('no tizen api'); return; }
  try {
    tizen.application.getAppsInfo(function (infos) {
      var list = [], icons = {}, seen = {};
      (infos || []).forEach(function (a) {
        if (!a || !a.id || a.show === false || HIDE.test(a.id) || !a.name) { return; }
        if (seen[a.id]) { return; }
        seen[a.id] = true;
        var ip = a.iconPath ? String(a.iconPath).replace(/^file:\/\//, '') : '';
        if (ip) { icons[a.id] = ip; }
        list.push({ id: String(a.id), name: String(a.name), icon: !!ip });
      });
      appCache = { at: Date.now(), list: list, icons: icons };
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
      if (!list.length || bad.length) { res.statusCode = 400; res.end('{"ok":false,"error":"only Google Calendar iCal links are accepted"}'); return; }
      var cfg = readCfg();
      cfg.calendars = list;
      if (!writeCfg(cfg)) { res.statusCode = 500; res.end('{"ok":false,"error":"could not save"}'); return; }
      calCache.at = 0; calCache.events = [];
      setup.done = true; setup.count = list.length;
      res.end(JSON.stringify({ ok: true, count: list.length }));
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
  '<button id="b">Send to TV</button><div id="m"></div>' +
  '<details><summary>Where do I find the secret iCal address?</summary><ol>' +
  '<li>On a computer, open calendar.google.com.</li><li>Left side: hover the calendar → ⋮ → <b>Settings and sharing</b>.</li>' +
  '<li>Scroll to <b>Integrate calendar</b> → <b>Secret address in iCal format</b> → copy.</li>' +
  '<li>Do the same in the other Google account (Aerones). If that field is missing, the company has switched it off.</li></ol></details>' +
  '</div><script>' +
  'var b=document.getElementById("b"),m=document.getElementById("m");function v(i){return document.getElementById(i).value.trim();}' +
  'b.onclick=function(){var c=[];if(v("u1"))c.push({label:v("l1")||"Calendar 1",url:v("u1")});if(v("u2"))c.push({label:v("l2")||"Calendar 2",url:v("u2")});' +
  'if(!c.length){m.className="bad";m.textContent="Paste at least one link.";return;}b.disabled=true;m.className="";m.textContent="Sending…";' +
  'var x=new XMLHttpRequest();x.open("POST","/setup");x.setRequestHeader("Content-Type","application/json");' +
  'x.onload=function(){var r={};try{r=JSON.parse(x.responseText);}catch(e){}if(r.ok){m.className="ok";m.textContent="Done ✓ "+r.count+" calendar(s) saved. You can close this page.";}' +
  'else{b.disabled=false;m.className="bad";m.textContent=r.error||"Did not work. Check the code and links.";}};' +
  'x.onerror=function(){b.disabled=false;m.className="bad";m.textContent="TV not reachable. Is the code still on the TV?";};' +
  'x.send(JSON.stringify({pin:v("pin").replace(/\\D/g,""),calendars:c}));};</script></body></html>';

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
        if (on) { queue.push({ key: 'KEY_POWER', res: { end: function () {} } }); next(); }
        log('sleep timer fired, TV ' + (on ? 'on -> KEY_POWER' : 'not on -> nothing'));
      });
    }).on('error', function () { log('sleep timer: status page not reachable, nothing sent'); });
  }, ts - Date.now());
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
    module: currentModule(), previous: cfg.prevTag || ''
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
  sendKeyRetry(job.key, function (err, last) {
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
