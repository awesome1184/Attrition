'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { GameEngine } = require('./game-engine');
const CONFIG = require('../game-config');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || CONFIG.server.port || 8080);
const HOST = process.env.HOST || CONFIG.server.host || '0.0.0.0';
const engine = new GameEngine(DATA_DIR);

let tickBusy = false;
function advanceWorld() {
  if (tickBusy) return;
  tickBusy = true;
  try { engine.syncToClock(Date.now()); } finally { tickBusy = false; }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { reject(new Error('Request too large.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}
function tokenFrom(req, body) {
  body = body || {};
  const header = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  return typeof body.token === 'string' ? body.token : '';
}
function playerId(req, body) {
  return engine.authenticate(tokenFrom(req, body));
}
function contentType(file) {
  return {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/' || requested === '/world.html') requested = '/index.html';
  const file = path.resolve(ROOT, '.' + requested);
  if (!file.startsWith(ROOT + path.sep) || file.includes(path.sep + '.git' + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':contentType(file),'Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  try {
    advanceWorld();
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {ok:true,service:'attrition-server',season:engine.state.season.number,tick:engine.state.tick,revision:engine.state.revision});
    }
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const body = await readJson(req);
      const session = engine.createSession(typeof body.token === 'string' ? body.token : '', typeof body.name === 'string' ? body.name.trim().slice(0,32) : '');
      return sendJson(res, 200, {token:session.token,player:{id:session.player.id,name:session.player.name,color:session.player.color},state:engine.snapshot(session.player.id)});
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const pid = playerId(req);
      if (!pid) return sendJson(res, 401, {error:'Unauthorized'});
      return sendJson(res, 200, engine.snapshot(pid));
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const body = await readJson(req);
      const pid = playerId(req, body);
      if (!pid) return sendJson(res, 401, {error:'Unauthorized'});
      const result = engine.action(pid, typeof body.action === 'string' ? body.action : '', body.args || {});
      return sendJson(res, 200, {result,state:engine.snapshot(pid)});
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, {error:'API endpoint not found'});
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, {error:err.message || 'Server error'});
  }
});

setInterval(advanceWorld, 60000);
server.listen(PORT, HOST, () => console.log('Attrition server listening on http://localhost:' + PORT));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));