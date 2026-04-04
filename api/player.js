const { getPlayer } = require('../lib/leaderboard-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const url = new URL(req.url, 'http://localhost');
    const address = url.searchParams.get('address') || '';
    const player = await getPlayer(address);
    res.end(JSON.stringify({ ok: true, player }));
  } catch (error) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: error.message || 'Player lookup failed' }));
  }
};
