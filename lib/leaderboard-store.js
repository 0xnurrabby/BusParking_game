const fs = require('fs');
const path = require('path');
let redis = null;
let Redis = null;
let restClient = null;

const DEV_FILE = path.join(process.cwd(), '.leaderboard-dev.json');
const PLAYER_HASH_KEY = 'busout:players';
const RANK_KEY = 'busout:players:rank';
const META_KEY = 'busout:leaderboard:meta';
const PUBLIC_LIMIT = 20;

function maskAddress(address) {
  if (!address || address.length < 14) return address || '';
  return address.slice(0, 6) + '...' + address.slice(-6);
}
function normalizeAddress(address) { return typeof address === 'string' ? address.trim() : ''; }
function validateAddress(address) { return /^0x[a-fA-F0-9]{40}$/.test(address); }
function getRedisEnv() {
  const raw = String(process.env.REDIS_URL || '').trim();
  const upstashUrl = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const upstashToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN || '').trim();
  return {
    tcpUrl: /^rediss?:\/\//i.test(raw) ? raw : '',
    restUrl: upstashUrl || (/^https?:\/\//i.test(raw) ? raw : ''),
    restToken: upstashToken
  };
}
function createRestClient(restUrl, restToken) {
  async function call(command) {
    const res = await fetch(restUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${restToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Redis REST failed (${res.status})`);
    return data.result;
  }
  async function pipeline(commands) {
    const res = await fetch(restUrl.replace(/\/$/, '') + '/pipeline', {
      method: 'POST',
      headers: { Authorization: `Bearer ${restToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Redis pipeline failed (${res.status})`);
    if (Array.isArray(data)) for (const item of data) if (item && item.error) throw new Error(item.error);
    return data;
  }
  return {
    async hgetall(key) {
      const result = await call(['HGETALL', key]);
      if (!Array.isArray(result)) return result || {};
      const out = {};
      for (let i = 0; i < result.length; i += 2) out[result[i]] = result[i + 1];
      return out;
    },
    async hget(key, field) { return call(['HGET', key, field]); },
    async zrevrange(key, start, stop, withscores) { return call(['ZREVRANGE', key, String(start), String(stop), withscores].filter(Boolean)); },
    multi() {
      const commands = [];
      return {
        hset(key, obj) {
          const args = ['HSET', key];
          Object.entries(obj).forEach(([k, v]) => args.push(k, String(v)));
          commands.push(args);
          return this;
        },
        zadd(key, score, member) { commands.push(['ZADD', key, String(score), member]); return this; },
        exec() { return pipeline(commands); }
      };
    }
  };
}
async function getRedis() {
  if (redis) return redis;
  if (restClient) return restClient;
  const { tcpUrl, restUrl, restToken } = getRedisEnv();
  if (restUrl && restToken) return (restClient = createRestClient(restUrl, restToken));
  if (!tcpUrl) return null;
  if (!Redis) Redis = require('ioredis');
  redis = new Redis(tcpUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: false });
  return redis;
}
function readDevStore() {
  try { return JSON.parse(fs.readFileSync(DEV_FILE, 'utf8')); }
  catch (_) { return { players: {}, meta: { updatedAt: null } }; }
}
function writeDevStore(data) { fs.writeFileSync(DEV_FILE, JSON.stringify(data, null, 2)); }
function txPerLevel() { return Math.max(1, Number(process.env.BUSOUT_TX_PER_LEVEL || 20)); }
function defaultAllowed(level) { return Math.max(1, Number(level || 0)) * txPerLevel(); }
function makePlayer(raw) {
  if (!raw || !raw.address) return null;
  const level = Math.max(0, Number(raw.level || 0));
  const txAllowed = Math.max(1, Number(raw.txAllowed || defaultAllowed(level)));
  const txSpent = Math.max(0, Number(raw.txSpent || 0));
  return {
    address: raw.address,
    maskedAddress: maskAddress(raw.address),
    coins: Math.max(0, Number(raw.coins || 0)),
    level,
    txSpent,
    txAllowed,
    txRemaining: Math.max(0, Number(raw.txRemaining != null ? raw.txRemaining : (txAllowed - txSpent))),
    walletName: raw.walletName || '',
    updatedAt: raw.updatedAt || new Date().toISOString(),
    version: Math.max(1, Number(raw.version || 1))
  };
}
function parseStoredPlayer(value, addressHint) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (addressHint && !parsed.address) parsed.address = addressHint;
      return makePlayer(parsed);
    } catch (_) { return null; }
  }
  if (typeof value === 'object') {
    const raw = { ...value };
    if (addressHint && !raw.address) raw.address = addressHint;
    return makePlayer(raw);
  }
  return null;
}
async function loadPlayerFromRedis(client, address) {
  const field = String(address || '').toLowerCase();
  const direct = parseStoredPlayer(await client.hget(PLAYER_HASH_KEY, field), address);
  if (direct) return direct;
  const legacy = await client.hgetall(`busout:player:${field}`);
  return makePlayer({ ...legacy, address });
}
function loadPlayerFromDev(db, address) { return parseStoredPlayer((db.players || {})[String(address || '').toLowerCase()], address); }
async function savePlayerRecord(client, player) {
  const multi = client.multi();
  multi.hset(PLAYER_HASH_KEY, { [player.address.toLowerCase()]: JSON.stringify(player) });
  multi.zadd(RANK_KEY, player.coins, player.address);
  multi.hset(META_KEY, { updatedAt: player.updatedAt });
  await multi.exec();
}
function savePlayerRecordDev(db, player) {
  db.players = db.players || {};
  db.players[player.address.toLowerCase()] = JSON.stringify(player);
  db.meta = db.meta || {};
  db.meta.updatedAt = player.updatedAt;
  writeDevStore(db);
}
function mergePlayerInput(existing, input) {
  const address = normalizeAddress(input.address || (existing && existing.address) || '');
  const coins = Math.max(0, Number(input.coins != null ? input.coins : (existing && existing.coins) || 0));
  const level = Math.max(0, Number(input.level != null ? input.level : (existing && existing.level) || 0));
  const txAllowed = Math.max(1, Number(input.txAllowed != null ? input.txAllowed : (existing && existing.txAllowed) || defaultAllowed(level)));
  const txSpent = Math.max(0, Number(input.txSpent != null ? input.txSpent : (existing && existing.txSpent) || 0));
  const txRemaining = Math.max(0, Number(input.txRemaining != null ? input.txRemaining : Math.max(0, txAllowed - txSpent)));
  return makePlayer({
    address, coins, level, txAllowed, txSpent, txRemaining,
    walletName: input.walletName != null ? String(input.walletName || '') : ((existing && existing.walletName) || ''),
    updatedAt: new Date().toISOString(),
    version: Math.max(1, Number((existing && existing.version) || 0) + 1)
  });
}
async function submitScore({ address, coins = 0, level = 0, txSpent = 0, txRemaining = 0, txAllowed = 0, walletName = '', knownVersion = null }) {
  const cleanAddress = normalizeAddress(address);
  if (!validateAddress(cleanAddress)) throw new Error('Invalid wallet address.');
  const client = await getRedis();
  if (client) {
    const existing = await loadPlayerFromRedis(client, cleanAddress);
    if (existing && knownVersion != null && Number(knownVersion) < Number(existing.version || 0)) return { ...existing, stale: true };
    const next = mergePlayerInput(existing, { address: cleanAddress, coins, level, txSpent, txRemaining, txAllowed, walletName });
    await savePlayerRecord(client, next);
    return next;
  }
  const db = readDevStore();
  const existing = loadPlayerFromDev(db, cleanAddress);
  if (existing && knownVersion != null && Number(knownVersion) < Number(existing.version || 0)) return { ...existing, stale: true };
  const next = mergePlayerInput(existing, { address: cleanAddress, coins, level, txSpent, txRemaining, txAllowed, walletName });
  savePlayerRecordDev(db, next);
  return next;
}
async function updatePlayerByAdmin(input) {
  const cleanAddress = normalizeAddress(input.address);
  if (!validateAddress(cleanAddress)) throw new Error('Invalid wallet address.');
  const client = await getRedis();
  if (client) {
    const existing = await loadPlayerFromRedis(client, cleanAddress);
    const next = mergePlayerInput(existing, { ...input, address: cleanAddress });
    await savePlayerRecord(client, next);
    return next;
  }
  const db = readDevStore();
  const existing = loadPlayerFromDev(db, cleanAddress);
  const next = mergePlayerInput(existing, { ...input, address: cleanAddress });
  savePlayerRecordDev(db, next);
  return next;
}
async function getTop(limit = PUBLIC_LIMIT) {
  const capped = Math.max(1, Number(limit || PUBLIC_LIMIT));
  const client = await getRedis();
  if (client) {
    const raw = await client.zrevrange(RANK_KEY, 0, capped - 1, 'WITHSCORES');
    const items = [];
    for (let i = 0; i < raw.length; i += 2) {
      const player = await loadPlayerFromRedis(client, raw[i]);
      if (player) items.push(player);
    }
    return { items, publishedAt: new Date().toISOString() };
  }
  const db = readDevStore();
  const items = Object.keys(db.players || {}).map((address) => loadPlayerFromDev(db, address)).filter(Boolean).sort((a,b)=>b.coins-a.coins).slice(0, capped);
  return { items, publishedAt: new Date().toISOString() };
}
async function getPlayer(address) {
  const cleanAddress = normalizeAddress(address);
  if (!validateAddress(cleanAddress)) return null;
  const client = await getRedis();
  if (client) return loadPlayerFromRedis(client, cleanAddress);
  return loadPlayerFromDev(readDevStore(), cleanAddress);
}
async function getAllPlayers(limit = 500) {
  const capped = Math.max(1, Number(limit || 500));
  const client = await getRedis();
  if (client) {
    const raw = await client.zrevrange(RANK_KEY, 0, capped - 1, 'WITHSCORES');
    const items = [];
    for (let i = 0; i < raw.length; i += 2) {
      const player = await loadPlayerFromRedis(client, raw[i]);
      if (player) items.push(player);
    }
    return items;
  }
  return Object.keys(readDevStore().players || {}).map((address) => loadPlayerFromDev(readDevStore(), address)).filter(Boolean).sort((a,b)=>b.coins-a.coins).slice(0, capped);
}
module.exports = { submitScore, updatePlayerByAdmin, getTop, getPlayer, getAllPlayers, validateAddress, maskAddress, PLAYER_HASH_KEY, RANK_KEY, PUBLIC_LIMIT };
