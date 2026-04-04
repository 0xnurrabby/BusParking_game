const http = require('http');
const fs = require('fs');
const path = require('path');
const leaderboardHandler = require('./api/leaderboard');
const configHandler = require('./api/config');
const playerHandler = require('./api/player');
const paymasterProxyHandler = require('./api/paymaster-proxy');
const adminPlayersHandler = require('./api/admin-players');

const root = process.cwd();
const port = Number(process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.isr': 'application/octet-stream'
};

function sendFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/leaderboard')) {
    req.body = await parseBody(req);
    return leaderboardHandler(req, res);
  }
  if (req.url.startsWith('/api/config')) {
    return configHandler(req, res);
  }
  if (req.url.startsWith('/api/player')) {
    return playerHandler(req, res);
  }
  if (req.url.startsWith('/api/paymaster-proxy')) {
    req.body = await parseBody(req);
    return paymasterProxyHandler(req, res);
  }
  if (req.url.startsWith('/api/admin/players')) {
    req.body = await parseBody(req);
    return adminPlayersHandler(req, res);
  }

  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index-x.html';
  const safePath = path.normalize(path.join(root, pathname));
  if (!safePath.startsWith(root)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  sendFile(safePath, res);
}).listen(port, () => {
  console.log(`Bus Parking Out local server running at http://localhost:${port}/index-x.html`);
});
