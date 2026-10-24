/* Greenwood Hub service (runs inside TizenBrew's Node service on the TV).
 *
 * One job: let the hub page send ONE remote key from a fixed allowlist
 * (HDMI 1-3, Menu, Source, Home) to the TV's own remote API.
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
var tls = require('tls');
var fs = require('fs');
var crypto = require('crypto');

var PORT = 8095;
var TOKEN_FILE = '/home/owner/share/greenwoodHubToken.txt';
var NAME_B64 = new Buffer('Greenwood Hub').toString('base64');
var ALLOWED = ['KEY_HDMI1', 'KEY_HDMI2', 'KEY_HDMI3', 'KEY_MENU', 'KEY_SOURCE', 'KEY_HOME'];
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

function sendKey(key, cb) {
  var token = readToken();
  var path = '/api/v2/channels/samsung.remote.control?name=' + encodeURIComponent(NAME_B64) +
    (token ? '&token=' + token : '');
  var done = false;
  var upgraded = false;
  var buf = new Buffer(0);
  var sock;
  var timer = setTimeout(function () { finish('timeout'); }, WAIT_MS);

  function finish(err) {
    if (done) { return; }
    done = true;
    clearTimeout(timer);
    try { sock.end(); } catch (e) { /* ignore */ }
    cb(err);
  }

  try {
    sock = tls.connect({ host: '127.0.0.1', port: 8002, rejectUnauthorized: false }, function () {
      var wsKey = crypto.randomBytes(16).toString('base64');
      sock.write('GET ' + path + ' HTTP/1.1\r\n' +
        'Host: 127.0.0.1:8002\r\n' +
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
      if (headers.indexOf(' 101') < 0) { finish('handshake'); return; }
      upgraded = true;
      buf = buf.slice(end + 4);
    }
    var parsed = parseFrames(buf);
    buf = parsed.rest;
    parsed.messages.forEach(function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.event === 'ms.channel.connect') {
        if (msg.data && msg.data.token) { saveToken(msg.data.token); }
        sock.write(frame(JSON.stringify({ method: 'ms.remote.control', params: {
          Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } })));
        setTimeout(function () { finish(null); }, 400);
      } else if (msg.event === 'ms.channel.unauthorized' || msg.event === 'ms.channel.timeOut') {
        finish('denied');
      }
    });
  });
  sock.on('error', function () { finish('error'); });
  sock.on('close', function () { finish(upgraded ? 'closed' : 'error'); });
}

var busy = false;
var server = http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  var m = /^\/key\?k=([A-Z0-9_]+)$/.exec(req.url || '');
  if (req.method !== 'GET' || !m) { res.statusCode = 404; res.end('{"ok":false,"error":"not found"}'); return; }
  var key = m[1];
  if (ALLOWED.indexOf(key) < 0) { res.statusCode = 403; res.end('{"ok":false,"error":"not allowed"}'); return; }
  if (busy) { res.end('{"ok":false,"error":"busy"}'); return; }
  busy = true;
  sendKey(key, function (err) {
    busy = false;
    res.end(JSON.stringify(err ? { ok: false, error: err } : { ok: true }));
  });
});
/* If the hub is opened again, an earlier copy may already hold the port: keep that one, never crash TizenBrew. */
server.on('error', function () { /* EADDRINUSE or similar: ignore */ });
server.listen(PORT, '127.0.0.1');
