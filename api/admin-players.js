const { getAllPlayers, updatePlayerByAdmin } = require('../lib/leaderboard-store');
function getExpectedKey() { return String(process.env.BUSOUT_ADMIN_KEY || process.env.ADMIN_KEY || '').trim(); }
function getProvidedKey(req) {
  const header = req.headers['x-admin-key'];
  if (header) return String(header).trim();
  try { return String(new URL(req.url, 'http://localhost').searchParams.get('key') || '').trim(); }
  catch (_) { return ''; }
}
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(''); return; }
  if (!getExpectedKey() || getProvidedKey(req) !== getExpectedKey()) {
    res.statusCode = 401; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Admin key required.' })); return;
  }
  try {
    if (req.method === 'GET') {
      const limit = Math.max(1, Number(new URL(req.url, 'http://localhost').searchParams.get('limit') || 500));
      const items = await getAllPlayers(limit);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, items, total: items.length })); return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const saved = await updatePlayerByAdmin(body);
      const items = await getAllPlayers(500);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, saved, items, total: items.length })); return;
    }
    res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  } catch (error) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: error.message || 'Admin request failed' }));
  }
};
