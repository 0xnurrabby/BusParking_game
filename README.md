<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=1,6,30&height=180&section=header&text=Bus+Parking+Out&fontSize=48&fontColor=000000&fontAlignY=38&desc=3D+puzzle+game+%E2%80%94+park+buses+in+the+right+order+to+clear+the+lot&descAlignY=58&descSize=14&animation=fadeIn" width="100%"/>

<div align="center">

[![Play](https://img.shields.io/badge/Play%20Now-bbf7d0?style=for-the-badge&logoColor=000)](https://busparking.vercel.app)
[![License](https://img.shields.io/badge/MIT-bfdbfe?style=for-the-badge&logoColor=000)](LICENSE)
[![Platform](https://img.shields.io/badge/Farcaster%20Mini%20App-fde68a?style=for-the-badge&logoColor=000)]()
[![Tech](https://img.shields.io/badge/BabylonJS%20%2B%20JavaScript-fca5a5?style=for-the-badge&logoColor=000)]()

</div>

<div align="center">
<i>A 3D bus parking puzzle game built with BabylonJS, playable as a Farcaster mini app on Base .... move buses in the correct order to get them all out.</i>
</div>

---

## ✦ Features

<div align="center">

| | Feature | What it does |
|:---:|---|---|
| 🚌 | 3D parking puzzle | Move buses out of the parking lot in the right order |
| 🎮 | BabylonJS engine | Full 3D rendering in browser with touch and mouse support |
| 📱 | Mobile-first | Designed for touch input inside Farcaster mini app clients |
| 🔗 | Farcaster native | Runs inside Base app / Warpcast as a Mini App |
| 🛡️ | No installs | Pure browser game, open and play immediately |

</div>

---

## ✦ Download & Run

**Step 1** .... Clone the repo

```bash
git clone https://github.com/0xnurrabby/BusParking_game
cd BusParking_game
```

**Step 2** .... Install server dependencies

```bash
npm install
```

**Step 3** .... Start the server

```bash
node server.js
# Open http://localhost:3000
# Or open index.html directly in a browser (no server needed for basic play)
```

---

## ✦ Setup

```
1. Clone the repo
2. Run npm install
3. Run node server.js  (or just open index.html directly)
4. Open http://localhost:3000 in your browser
5. Use mouse or touch to interact with buses
6. To test as Farcaster mini app: deploy to Vercel
   and open inside Warpcast or Base app
```

---

## ✦ Project Structure

```
BusParking_game/
  index.html         ->  game entry point with BabylonJS canvas
  server.js          ->  simple Node.js static file server
  js/
    game.js          ->  main game logic, level design, bus movement
    lib/
      babylon.js              ->  BabylonJS 3D engine
      babylon.gui.min.js      ->  BabylonJS GUI
      babylonjs.loaders.min.js->  BabylonJS asset loaders
  assets/            ->  game fonts, sounds, textures
  api/               ->  Vercel serverless functions
  webapp.js          ->  wallet integration for on-chain features
  vercel.json        ->  Vercel deployment config
```

---

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=1,6,30&height=100&section=footer&animation=fadeIn" width="100%"/>

<div align="center">MIT License .... built by <a href="https://github.com/0xnurrabby">0xnurrabby</a></div>
