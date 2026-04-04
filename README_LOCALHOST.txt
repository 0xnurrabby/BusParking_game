Bus Parking Out - Localhost + Vercel notes

Local run:
1. npm install
2. npm run dev
3. open http://localhost:8000/index-x.html
4. admin editor: http://localhost:8000/admin-players.html

Vercel / local env vars:
- REDIS_URL
- BUSOUT_TX_PER_LEVEL
- BUSOUT_BONUS_MIN
- BUSOUT_BONUS_MAX
- BUSOUT_BUILDER_CODE
- CDP_PAYMASTER_URL
- PAYMASTER_PROXY_TARGET
- BUSOUT_ADMIN_KEY

Admin player editor:
- This is separate from the game UI.
- Open /admin-players.html manually.
- Enter BUSOUT_ADMIN_KEY there.
- It reads and writes the central Redis player hash and re-sorts the live ranking automatically.

Redis structure after this fix:
- busout:players         -> single central hash, one field per wallet address, JSON player record
- busout:players:rank    -> sorted set for live top-to-low order
- old legacy per-player keys can still be read as fallback

Leaderboard behavior after this fix:
- Public leaderboard shows top 20 only
- Requires minimum 5000 gold to unlock in the app
- Scroll is enabled
- "Address hidden in app" line removed

Conflict handling:
- Every player record now has a version number
- Admin edits increase version
- Game sync sends knownVersion, so stale client data cannot immediately overwrite a newer admin edit
