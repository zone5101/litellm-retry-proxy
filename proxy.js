'use strict';
// LiteLLM Retry Proxy — local transparent retry layer for VS Code litellm-vscode-chat
// Route: http://127.0.0.1:<port>/<tag>/* -> upstream base URL (headers, incl. Authorization, forwarded as-is)
// Retries transient network errors and HTTP 429/5xx while nothing has been sent downstream yet.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const UP = CFG.upstreams || {}, PORT = CFG.port || 4010, MAX = Math.max(1, CFG.maxAttempts || 6);
const BACKOFF_BASE = 500, BACKOFF_CAP = 8000, RA_CAP = 15000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const LOGFILE = path.join(__dirname, 'proxy.log');
const stats = { requests: 0, retries: 0, failures: 0, started: new Date().toISOString() };
function log(s) { const l = '[' + new Date().toISOString() + '] ' + s; try { fs.appendFileSync(LOGFILE, l + '\n'); } catch (e) {} try { console.log(l); } catch (e) {} }
function readBody(req, cb) {
  const ch = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > 25e6) { req.destroy(); cb(new Error('request body too large')); } else ch.push(c); });
  req.on('end', () => cb(null, Buffer.concat(ch)));
  req.on('error', e => cb(e));
}
const server = http.createServer((req, res) => {
  stats.requests++;
  let u; try { u = new URL(req.url, 'http://localhost'); } catch (e) { try { res.writeHead(400); res.end(); } catch (e2) {} return; }
  const tag = decodeURIComponent((u.pathname.split('/')[1] || '').toLowerCase());
  if (tag === '__health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, pid: process.pid, uptime_s: Math.round(process.uptime()), started: stats.started, requests: stats.requests, retries: stats.retries, failures: stats.failures, routes: Object.keys(UP) })); return; }
  const base = UP[tag];
  if (!base) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: "unknown route '" + tag + "'", available: Object.keys(UP) })); return; }
  const rest = u.pathname.slice(('/' + tag).length) + u.search;
  let target; try { target = new URL(base.replace(/\/+$/, '') + (rest || '/')); } catch (e) { try { res.writeHead(502); res.end('bad upstream url'); } catch (e2) {} return; }
  readBody(req, (e, body) => { if (e) { log(tag + ' ' + req.method + ' body error: ' + e.message); try { res.writeHead(413); res.end(); } catch (e2) {} return; } go(req, res, tag, target, body, 1); });
});
server.requestTimeout = 0; server.headersTimeout = 65000; server.keepAliveTimeout = 75000;
function go(req, res, tag, target, body, n) {
  const lib = target.protocol === 'https:' ? https : http;
  const h = Object.assign({}, req.headers);
  delete h.host; delete h.connection; delete h['content-length']; delete h['transfer-encoding']; delete h['accept-encoding'];
  h.host = target.host;
  const opts = { method: req.method, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), path: target.pathname + target.search, headers: h };
  if (body && body.length) opts.headers['content-length'] = body.length;
  let done = false, sent = false;
  const fail = (why) => {
    if (done || res.writableEnded || res.destroyed) return;
    if (n >= MAX) {
      done = true; stats.failures++;
      log(tag + ' ' + req.method + ' ' + target.pathname + ' FAILED after ' + n + ' attempts: ' + why);
      try { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'upstream_failed_after_retries', attempts: n, cause: String(why) })); } catch (e) {}
      return;
    }
    const delay = Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, n - 1));
    stats.retries++;
    log(tag + ' ' + req.method + ' attempt ' + n + '/' + MAX + ' failed (' + why + ') -> retry in ' + delay + 'ms');
    done = true; // stop this attempt's event handlers; next attempt owns the response
    setTimeout(() => go(req, res, tag, target, body, n + 1), delay);
  };
  let r;
  try { r = lib.request(opts, ur => {
    const st = ur.statusCode;
    if (RETRY_STATUS.has(st) && n < MAX) {
      let ra = parseInt(ur.headers['retry-after'], 10);
      const delay = isFinite(ra) && ra > 0 ? Math.min(RA_CAP, ra * 1000) : Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, n - 1));
      stats.retries++;
      log(tag + ' ' + req.method + ' attempt ' + n + '/' + MAX + ' got HTTP ' + st + ' -> retry in ' + delay + 'ms');
      ur.resume(); done = true;
      setTimeout(() => go(req, res, tag, target, body, n + 1), delay);
      return;
    }
    done = true; sent = true;
    const hh = Object.assign({}, ur.headers); delete hh['transfer-encoding'];
    res.writeHead(st, hh);
    ur.on('data', () => { sent = true; });
    ur.pipe(res);
    ur.on('error', e2 => { log(tag + ' ' + req.method + ' upstream error mid-stream (already sent): ' + (e2.code || e2.message)); try { res.destroy(); } catch (e3) {} });
    ur.on('end', () => log(tag + ' ' + req.method + ' ' + target.pathname + ' -> ' + st + ' ok (' + (Date.now() - t0) + 'ms)'));
  }); } catch (e) { fail(e && (e.code || e.message)); return; }
  const t0 = Date.now();
  r.setTimeout(600000, () => r.destroy(new Error('upstream idle timeout 600s')));
  r.on('error', e => fail(e && (e.code || e.message) || 'socket error'));
  if (body && body.length) r.end(body); else r.end();
  req.on('close', () => { if (!done) { try { r.destroy(); } catch (e) {} } });
}
log('LiteLLM Retry Proxy v1 listening on 127.0.0.1:' + PORT + ' | routes: ' + Object.keys(UP).join(', '));
server.on('error', e => { log('server error: ' + (e && e.code || e.message) + ' — exiting (port likely already in use by another proxy instance)'); process.exit(0); });
server.listen(PORT, '127.0.0.1');
