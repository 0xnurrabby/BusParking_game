(function () {
  'use strict';

  const BASE_MAINNET = {
    chainIdHex: '0x2105',
    chainId: 8453,
    chainName: 'Base Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org']
  };

  const DEFAULTS = {
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    usdcSymbol: 'USDC',
    storeRecipient: '0xe8Bda2Ed9d2FC622D900C8a76dc455A3e79B041f',
    scoreContract: '0xD2DF0E19d481690C505Ad79baBE403A1038248B7',
    builderCode: 'bc_gcr4i5kz',
    txPerLevel: 20,
    bonusMin: 50,
    bonusMax: 100,
    paymasterProxyPath: '/api/paymaster-proxy',
    paymasterMode: 'disabled',
    walletModalSubtitle: 'Detected wallets on this device',
    packs: [
      { id: 'p1', coins: 1000, usdc: 0.1, label: '1K Coin', priceLabel: '$0.10' },
      { id: 'p2', coins: 10000, usdc: 1, label: '10K Coin', priceLabel: '$1.00' },
      { id: 'p3', coins: 50000, usdc: 5, label: '50K Coin', priceLabel: '$5.00' },
      { id: 'p4', coins: 100000, usdc: 10, label: '100K Coin', priceLabel: '$10.00' }
    ]
  };

  const SELECTOR_TRANSFER = '0xa9059cbb';
  const SELECTOR_SUBMIT_SCORE = '0x038cfeb7';
  const EIP6963_ANNOUNCE = 'eip6963:announceProvider';
  const EIP6963_REQUEST = 'eip6963:requestProvider';
  const ERC8021_MARKER = '80218021802180218021802180218021';
  const BUILDER_CODE_PLACEHOLDER = 'PASTE_YOUR_BUILDER_CODE_HERE';
  const LEADERBOARD_UNLOCK_GOLD = 5000;
  const LEADERBOARD_LIMIT = 20;

  const state = {
    address: localStorage.getItem('busout_wallet_address') || '',
    walletName: localStorage.getItem('busout_wallet_name') || '',
    chainId: null,
    connected: false,
    coins: 0,
    level: 0,
    txSpent: 0,
    txRemaining: 0,
    leaderboard: [],
    leaderboardPublishedAt: null,
    syncTimer: null,
    lastSyncedCoins: -1,
    uiReady: false,
    hasEnteredGame: false,
    mobileMenuOpen: false,
    config: { ...DEFAULTS },
    playerLoaded: false,
    providerCapabilities: null,
    providerFamily: '',
    remoteTxSpent: 0,
    playerVersion: 0,
    playerSyncTimer: null,
  };

  const providerRegistry = new Map();

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --chain-blue-1: #35b6ff;
        --chain-blue-2: #1184ff;
        --chain-blue-3: #0a61cf;
        --chain-green-1: #eff8c8;
        --chain-green-2: #dceaa5;
        --chain-green-3: #b2cd68;
        --chain-white: #f8fbff;
        --chain-ink: #112743;
        --chain-outline: #09284f;
        --chain-shadow: 0 8px 0 rgba(7, 34, 66, 0.88);
        --chain-soft-shadow: 0 10px 28px rgba(8, 32, 59, 0.28);
      }
      .chain-hidden { display: none !important; }
      .chain-safe-wrap {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      .chain-desktop-top,
      .chain-left-store,
      .chain-mobile-trigger-wrap,
      .chain-mobile-menu {
        position: fixed;
        display: flex;
        gap: 12px;
        pointer-events: none;
      }
      .chain-desktop-top {
        top: 16px;
        right: 138px;
        align-items: flex-start;
        z-index: 2147482499;
      }
      .chain-left-store {
        top: 16px;
        left: 14px;
        z-index: 2147482499;
      }
      .chain-mobile-trigger-wrap {
        display: none;
        left: 10px;
        top: 10px;
        z-index: 2147482499;
      }
      .chain-mobile-menu {
        display: none;
        left: 10px;
        top: 64px;
        z-index: 2147482500;
        pointer-events: none;
      }
      .chain-mobile-menu.open { display: flex; pointer-events: auto; }
      .chain-mobile-panel {
        pointer-events: auto;
        width: min(92vw, 320px);
        max-width: calc(100vw - 20px);
        min-width: 0;
        border: 3px solid var(--chain-outline);
        border-radius: 22px;
        box-shadow: var(--chain-shadow), var(--chain-soft-shadow);
        background: linear-gradient(180deg, rgba(244,251,255,0.98) 0%, rgba(214,233,247,0.98) 100%);
        padding: 12px;
        display: grid;
        gap: 10px;
      }
      .chain-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: stretch;
        pointer-events: none;
      }
      .chain-row {
        display: flex;
        gap: 10px;
        align-items: center;
        pointer-events: none;
      }
      .chain-card,
      .chain-btn,
      .chain-mini-btn,
      .chain-menu-trigger {
        pointer-events: auto;
        border: 3px solid var(--chain-outline);
        border-radius: 20px;
        box-shadow: var(--chain-shadow), var(--chain-soft-shadow);
        color: var(--chain-ink);
        font-family: gamefont, Arial, sans-serif;
      }
      .chain-card {
        background: linear-gradient(180deg, #f9fdff 0%, #dfedf8 100%);
        min-height: 52px;
        padding: 0 16px;
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        max-width: 290px;
        box-sizing: border-box;
        overflow: hidden;
      }
      .chain-card > * { min-width: 0; }
      .chain-card .addr {
        font-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .chain-card .meta {
        font-size: 12px;
        color: #566b85;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .chain-btn,
      .chain-mini-btn,
      .chain-menu-trigger {
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .chain-btn {
        min-height: 52px;
        padding: 0 18px;
        font-size: 15px;
        background: linear-gradient(180deg, var(--chain-blue-1) 0%, var(--chain-blue-2) 70%, var(--chain-blue-3) 100%);
        color: white;
        text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
      }
      .chain-btn.green {
        background: linear-gradient(180deg, var(--chain-green-1) 0%, var(--chain-green-2) 65%, var(--chain-green-3) 100%);
        color: #233654;
        text-shadow: none;
      }
      .chain-mini-btn {
        min-height: 46px;
        padding: 0 16px;
        font-size: 14px;
        background: linear-gradient(180deg, #f9fdff 0%, #d8e7f5 100%);
      }
      .chain-store-btn {
        min-width: 136px;
      }
      .chain-menu-trigger {
        width: 52px;
        height: 52px;
        background: linear-gradient(180deg, #f9fdff 0%, #d8e7f5 100%);
        position: relative;
      }
      .chain-menu-trigger span {
        position: absolute;
        left: 13px;
        right: 13px;
        height: 4px;
        border-radius: 6px;
        background: var(--chain-outline);
      }
      .chain-menu-trigger span:nth-child(1) { top: 14px; }
      .chain-menu-trigger span:nth-child(2) { top: 23px; }
      .chain-menu-trigger span:nth-child(3) { top: 32px; }
      .chain-gate,
      .chain-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(13, 26, 44, 0.45);
        backdrop-filter: blur(5px);
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      .chain-modal,
      .chain-gate-card {
        width: min(92vw, 860px);
        border: 4px solid var(--chain-outline);
        border-radius: 30px;
        box-shadow: 0 12px 0 rgba(7, 34, 66, 0.94), 0 28px 45px rgba(7, 34, 66, 0.42);
        background: linear-gradient(180deg, #bfe9ff 0%, #95d7ff 100%);
        overflow: hidden;
      }
      .chain-gate-card { width: min(92vw, 640px); }
      .chain-modal-head {
        padding: 18px 22px;
        background: linear-gradient(180deg, #1aa3ff 0%, #0e83ff 100%);
        color: white;
        border-bottom: 4px solid var(--chain-outline);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .chain-title {
        margin: 0;
        font-size: 28px;
        line-height: 1;
        text-shadow: 0 3px 0 rgba(0, 0, 0, 0.28);
      }
      .chain-subtitle {
        margin: 6px 0 0;
        font-size: 13px;
        color: rgba(255,255,255,0.92);
        line-height: 1.5;
      }
      .chain-modal-body {
        background: linear-gradient(180deg, #d9f2ff 0%, #b7e6ff 100%);
        padding: 20px;
      }
      .chain-modal-body.rank-body {
        max-height: min(72vh, 640px);
        overflow-y: auto;
      }
      .chain-close {
        width: 44px;
        height: 44px;
        border-radius: 16px;
        border: 3px solid var(--chain-outline);
        background: linear-gradient(180deg, #fff3f5 0%, #ffd3dc 100%);
        color: #703847;
        font-size: 22px;
        box-shadow: var(--chain-shadow);
        cursor: pointer;
      }
      .chain-wallet-grid,
      .chain-store-grid {
        display: grid;
        gap: 14px;
      }
      .chain-wallet-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); max-height: min(62vh, 560px); overflow: auto; padding-right: 4px; align-content: start; }
      .chain-store-grid { grid-template-columns: repeat(2, minmax(180px, 1fr)); margin-top: 14px; }
      .chain-wallet-item,
      .chain-store-card,
      .chain-free-card,
      .chain-rank-row {
        border: 3px solid var(--chain-outline);
        border-radius: 24px;
        background: linear-gradient(180deg, #ffffff 0%, #e6f2fb 100%);
        box-shadow: var(--chain-shadow);
      }
      .chain-wallet-item {
        min-height: 76px;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }
      .chain-wallet-copy { min-width: 0; flex: 1 1 auto; }
      .chain-wallet-name { font-size: 18px; color: #173252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chain-wallet-sub { font-size: 12px; color: #566b85; line-height: 1.35; }
      .chain-wallet-copy { min-width: 0; display: grid; gap: 3px; }
      .chain-wallet-copy > div:first-child { font-size: 15px; line-height: 1.1; }
      .chain-wallet-copy > div:last-child { font-size: 12px; line-height: 1.35; color: #4d6280; }
      .chain-wallet-icon,
      .chain-inline-icon {
        width: 46px;
        height: 46px;
        border-radius: 16px;
        border: 3px solid var(--chain-outline);
        background: linear-gradient(180deg, #eff8c8 0%, #dceaa5 100%);
        display: grid;
        place-items: center;
        flex: none;
        font-size: 18px;
      }
      .chain-two-col {
        display: grid;
        grid-template-columns: 1.08fr 0.92fr;
        gap: 16px;
        align-items: start;
      }
      .chain-note-panel {
        border: 3px solid var(--chain-outline);
        border-radius: 24px;
        background: linear-gradient(180deg, #ffffff 0%, #e7f3ff 100%);
        box-shadow: var(--chain-shadow);
        padding: 16px;
      }
      .chain-note-row {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        margin-bottom: 12px;
        color: #173252;
      }
      .chain-free-card,
      .chain-store-card {
        padding: 14px;
        display: grid;
        gap: 10px;
      }
      .chain-free-button,
      .chain-store-buy {
        min-height: 50px;
        border-radius: 18px;
        border: 3px solid var(--chain-outline);
        background: linear-gradient(180deg, #35b6ff 0%, #1184ff 70%, #0a61cf 100%);
        box-shadow: var(--chain-shadow);
        color: white;
        font-family: gamefont, Arial, sans-serif;
        font-size: 16px;
        cursor: pointer;
      }
      .chain-free-button {
        background: linear-gradient(180deg, #eff8c8 0%, #dceaa5 65%, #b2cd68 100%);
        color: #173252;
      }
      .chain-mini-text,
      .chain-status,
      .chain-rank-meta {
        font-size: 12px;
        color: #566b85;
        line-height: 1.45;
      }
      .chain-status { min-height: 18px; margin-top: 10px; }
      .chain-status-row { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top: 12px; flex-wrap:wrap; }
      .chain-tx-pill {
        padding: 8px 14px;
        border: 3px solid var(--chain-outline);
        border-radius: 18px;
        background: linear-gradient(180deg, #f9fdff 0%, #d8e7f5 100%);
        box-shadow: var(--chain-shadow);
        font-size: 12px;
        color: #29405f;
      }
      .chain-toast-wrap {
        position: fixed;
        left: 50%;
        top: 26px;
        transform: translateX(-50%);
        z-index: 2147483000;
        display: grid;
        gap: 10px;
        pointer-events: none;
        width: min(92vw, 420px);
      }
      .chain-toast {
        border: 3px solid var(--chain-outline);
        border-radius: 22px;
        box-shadow: var(--chain-shadow), var(--chain-soft-shadow);
        background: linear-gradient(180deg, #eff8c8 0%, #dceaa5 65%, #b2cd68 100%);
        color: #173252;
        padding: 16px 18px;
        font-size: 18px;
        line-height: 1.3;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity .18s ease, transform .18s ease;
      }
      .chain-toast.show { opacity: 1; transform: translateY(0); }
      .chain-toast.error { background: linear-gradient(180deg, #fff1f5 0%, #ffd6de 100%); color:#7a2e48; }
      .chain-rank-list { display: grid; gap: 10px; }
      .chain-lock-card { border: 3px solid var(--chain-outline); border-radius: 24px; background: linear-gradient(180deg, #ffffff 0%, #e6f2fb 100%); box-shadow: var(--chain-shadow); padding: 22px; display: grid; gap: 10px; color: #173252; text-align: center; }
      .chain-rank-row {
        padding: 12px 14px;
        display: grid;
        grid-template-columns: 60px 1fr 120px;
        gap: 10px;
        align-items: center;
      }
      .chain-rank-row.me { background: linear-gradient(180deg, #eff8c8 0%, #dceaa5 100%); }
      .chain-rank-score { text-align: right; }
      .chain-foot-note { margin-top: 14px; }
      @media (max-width: 980px) {
        .chain-two-col { grid-template-columns: 1fr; }
      }
      @media (max-width: 760px) {
        .chain-desktop-top,
        .chain-left-store { display: none !important; }
        .chain-mobile-trigger-wrap { display: flex; }
        .chain-mobile-menu.open { display: flex; pointer-events: auto; }
        .chain-title { font-size: 22px; }
        .chain-modal, .chain-gate-card { width: min(96vw, 700px); border-radius: 24px; }
        .chain-modal-body { padding: 10px; }
        .chain-wallet-grid { grid-template-columns: 1fr; }
        .chain-store-grid { grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
        .chain-rank-row { grid-template-columns: 42px 1fr 78px; }
        #chain-store-modal .chain-modal { width: min(96vw, 520px); }
        #chain-store-modal .chain-modal-body { display: grid; gap: 8px; }
        #chain-store-modal .chain-free-card,
        #chain-store-modal .chain-store-card { padding: 10px; gap: 6px; border-radius: 20px; }
        #chain-store-modal .chain-free-card > div:first-child { font-size: 18px !important; }
        #chain-store-modal .chain-store-card > div:first-child { font-size: 15px !important; }
        #chain-store-modal .chain-mini-text,
        #chain-store-modal .chain-foot-note,
        #chain-store-modal .chain-tx-pill,
        #chain-store-modal .chain-status { font-size: 10px; line-height: 1.25; }
        #chain-store-modal .chain-free-button,
        #chain-store-modal .chain-store-buy { min-height: 38px; font-size: 12px; border-radius: 15px; }
        .chain-toast-wrap { top: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 18px); width: min(92vw, 330px); }
        .chain-toast { font-size: 13px; padding: 12px 14px; border-radius: 18px; }
        .chain-mobile-panel .chain-card { min-height: 42px; width: 100%; max-width: 100%; justify-content: space-between; padding: 0 10px; box-sizing: border-box; }
        .chain-mobile-panel .chain-card .addr { font-size: 11px; max-width: 138px; }
        .chain-mobile-panel .chain-card .meta { font-size: 9px; max-width: 110px; text-align: right; }
        .chain-mobile-panel .chain-btn,
        .chain-mobile-panel .chain-mini-btn { width: 100%; min-height: 40px; font-size: 12px; padding: 0 12px; border-radius: 16px; box-sizing: border-box; }
        .chain-mobile-panel { width: min(94vw, 340px); max-width: calc(100vw - 20px); }
        .chain-mobile-menu { left: 8px; right: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function maskAddress(address) {
    if (!address || address.length < 14) return address || 'Wallet locked';
    return address.slice(0, 6) + '...' + address.slice(-6);
  }

  function formatCoins(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function getLevelIndex() {
    return Math.max(1, Number(state.level) || 0);
  }

  function getAllowedTxCount() {
    return getLevelIndex() * Math.max(1, Number(state.config.txPerLevel || DEFAULTS.txPerLevel));
  }

  function getTxStorageKey(address) {
    return 'busout_tx_spent_' + String(address || '').toLowerCase();
  }

  function loadTxSpent(address) {
    if (!address) return 0;
    return Math.max(0, Number(localStorage.getItem(getTxStorageKey(address))) || 0);
  }

  function saveTxSpent() {
    if (!state.address) return;
    localStorage.setItem(getTxStorageKey(state.address), String(state.txSpent || 0));
  }

  function refreshTxBudget() {
    const allowed = getAllowedTxCount();
    if (!state.address) {
      state.txSpent = 0;
      state.txRemaining = allowed;
      return;
    }
    state.txSpent = Math.max(state.txSpent, loadTxSpent(state.address));
    if (state.playerLoaded && state.remoteTxSpent > state.txSpent) state.txSpent = state.remoteTxSpent;
    state.txRemaining = Math.max(0, allowed - state.txSpent);
    saveTxSpent();
  }

  function ensureTxBudget() {
    refreshTxBudget();
    if (state.txRemaining <= 0) {
      throw new Error('No transaction quota left for your current level.');
    }
  }

  function consumeTxBudget() {
    state.txSpent = Math.max(0, Number(state.txSpent || 0) + 1);
    refreshTxBudget();
    updateUi();
    scheduleSync(true);
  }

  function getBuilderCode() {
    return String(state.config.builderCode || localStorage.getItem('busout_builder_code') || '').trim();
  }

  function getBuilderCodes() {
    return getBuilderCode()
      .split(',')
      .map((value) => String(value || '').trim())
      .filter((value) => value && value !== BUILDER_CODE_PLACEHOLDER);
  }

  function builderSuffixHex() {
    const codes = getBuilderCodes();
    if (!codes.length) return '';
    let encodedCodes = '';
    for (const code of codes) {
      const bytes = Array.from(new TextEncoder().encode(code));
      if (bytes.length > 255) throw new Error('Builder code is too long for ERC-8021 schema 0.');
      encodedCodes += bytes.length.toString(16).padStart(2, '0');
      encodedCodes += bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return '0x' + encodedCodes + '00' + ERC8021_MARKER;
  }

  function hasBuilderSuffix(dataHex) {
    const clean = String(dataHex || '').toLowerCase().replace(/^0x/, '');
    return !!clean && clean.includes(ERC8021_MARKER.toLowerCase());
  }

  function applyBuilderSuffix(dataHex, suffixHex) {
    const suffix = suffixHex || builderSuffixHex();
    if (!suffix) return dataHex || '0x';
    if (hasBuilderSuffix(dataHex)) return dataHex || '0x';
    const clean = String(dataHex || '0x').replace(/^0x/, '');
    return '0x' + clean + suffix.replace(/^0x/, '');
  }

  function getPaymasterProxyUrl() {
    if (!state.config.paymasterEnabled) return '';
    const configuredPath = String(state.config.paymasterProxyPath || '/api/paymaster-proxy').trim() || '/api/paymaster-proxy';
    if (/^https?:\/\//i.test(configuredPath)) return configuredPath;
    return window.location.origin.replace(/\/$/, '') + (configuredPath.startsWith('/') ? configuredPath : '/' + configuredPath);
  }

  async function getWalletCapabilities(provider) {
    if (!provider || !state.address) return null;
    try {
      const capabilities = await provider.request({ method: 'wallet_getCapabilities', params: [state.address] });
      state.providerCapabilities = capabilities || null;
      return capabilities || null;
    } catch (_) {
      state.providerCapabilities = null;
      return null;
    }
  }

  function getChainCapabilities(capabilities) {
    if (!capabilities) return null;
    return capabilities[BASE_MAINNET.chainIdHex] || capabilities[String(BASE_MAINNET.chainId)] || capabilities['eip155:' + BASE_MAINNET.chainId] || null;
  }

  function normalizeTransactionResult(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
      return result.transactionHash || result.hash || result.batchId || result.id || '';
    }
    return String(result);
  }

  function showToast(message, type) {
    const wrap = document.getElementById('chain-toast-wrap');
    if (!wrap) return;
    const toast = document.createElement('div');
    toast.className = 'chain-toast' + (type === 'error' ? ' error' : '');
    toast.textContent = message;
    wrap.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  function hexPad(value, lengthBytes) {
    let hex = value.toString(16);
    while (hex.length < lengthBytes * 2) hex = '0' + hex;
    return hex;
  }

  function encodeAddressParam(address) {
    return hexPad(BigInt(address.toLowerCase()), 32);
  }

  function encodeUintParam(value) {
    return hexPad(BigInt(value), 32);
  }

  function encodeTransfer(to, rawAmount) {
    return SELECTOR_TRANSFER + encodeAddressParam(to) + encodeUintParam(rawAmount);
  }

  function encodeSubmitScore(score) {
    return SELECTOR_SUBMIT_SCORE + encodeUintParam(score);
  }

  function isExcludedNonEvmProvider(provider, meta) {
    const infoName = meta && meta.info && meta.info.name ? String(meta.info.name).toLowerCase() : '';
    const rdns = meta && meta.info && meta.info.rdns ? String(meta.info.rdns).toLowerCase() : '';
    const flags = [
      provider && provider.isPhantom,
      provider && provider.isKeplr,
      provider && provider.isLeap,
      provider && provider.isCosmostation,
      provider && provider.isBackpack,
      provider && provider.isSolflare,
    ].some(Boolean);
    const blocked = ['phantom', 'keplr', 'leap', 'cosmostation', 'solflare', 'backpack'];
    return flags || blocked.some((key) => infoName.includes(key) || rdns.includes(key));
  }

  function walletFamilyFromMeta(provider, meta) {
    const infoName = meta && meta.info && meta.info.name ? String(meta.info.name).toLowerCase() : '';
    const rdns = meta && meta.info && meta.info.rdns ? String(meta.info.rdns).toLowerCase() : '';
    if (isExcludedNonEvmProvider(provider, meta)) return '';
    if (provider.isRabby || infoName.includes('rabby') || rdns.includes('rabby')) return 'rabby';
    if (provider.isOkxWallet || provider.isOKExWallet || infoName.includes('okx') || rdns.includes('okx')) return 'okx';
    if (provider.isTrust || provider.isTrustWallet || infoName.includes('trust') || rdns.includes('trust')) return 'trust';
    if (provider.isBitKeep || provider.isBitgetWallet || infoName.includes('bitget') || infoName.includes('bitkeep') || rdns.includes('bitget') || rdns.includes('bitkeep')) return 'bitget';
    if ((provider.isMetaMask || infoName.includes('metamask') || rdns.includes('metamask')) && !provider.isCoinbaseWallet && !provider.isTrust && !provider.isTrustWallet && !provider.isBitKeep && !provider.isBitgetWallet && !provider.isOkxWallet && !provider.isOKExWallet && !provider.isRabby) return 'metamask';
    if (provider.isCoinbaseWallet || infoName.includes('coinbase') || infoName.includes('base wallet') || rdns.includes('coinbase')) return 'basewallet';
    return '';
  }

  function providerDisplayNameFromMeta(provider, meta) {
    const family = walletFamilyFromMeta(provider, meta);
    if (family === 'rabby') return 'Rabby Wallet';
    if (family === 'okx') return 'OKX Wallet';
    if (family === 'trust') return 'Trust Wallet';
    if (family === 'bitget') return 'Bitget Wallet';
    if (family === 'metamask') return 'MetaMask';
    if (family === 'basewallet') return 'Base Wallet';
    const infoName = meta && meta.info && meta.info.name ? String(meta.info.name).trim() : '';
    return infoName || '';
  }

  function providerKey(provider, meta) {
    const rdns = meta && meta.info && meta.info.rdns ? meta.info.rdns : '';
    const uuid = meta && meta.info && meta.info.uuid ? meta.info.uuid : '';
    return [walletFamilyFromMeta(provider, meta), uuid, rdns].filter(Boolean).join(':');
  }

  function registerProvider(provider, meta) {
    if (!provider) return;
    const family = walletFamilyFromMeta(provider, meta);
    if (!family) return;
    const key = providerKey(provider, meta);
    const item = {
      name: providerDisplayNameFromMeta(provider, meta),
      provider,
      meta: meta || null,
    };
    if (!item.name) return;
    providerRegistry.set(key, item);
  }

  function discoverFallbackProviders() {
    const eth = window.ethereum;
    if (!eth) return;
    const raw = Array.isArray(eth.providers) ? eth.providers : [eth];
    raw.forEach((provider) => registerProvider(provider, null));
    if (window.okxwallet) registerProvider(window.okxwallet, { info: { name: 'OKX Wallet', rdns: 'com.okex.wallet' } });
    if (window.trustwallet) registerProvider(window.trustwallet, { info: { name: 'Trust Wallet', rdns: 'com.trustwallet.app' } });
    if (window.bitkeep && window.bitkeep.ethereum) registerProvider(window.bitkeep.ethereum, { info: { name: 'Bitget Wallet', rdns: 'com.bitget.wallet' } });
    if (window.coinbaseWalletExtension) registerProvider(window.coinbaseWalletExtension, { info: { name: 'Base Wallet', rdns: 'com.coinbase.wallet' } });
  }

  function announceListener(event) {
    if (!event || !event.detail || !event.detail.provider) return;
    registerProvider(event.detail.provider, event.detail);
    renderWalletOptions();
  }

  function setupProviderDiscovery() {
    window.addEventListener(EIP6963_ANNOUNCE, announceListener);
    discoverFallbackProviders();
    window.dispatchEvent(new Event(EIP6963_REQUEST));
    setTimeout(() => {
      discoverFallbackProviders();
      renderWalletOptions();
    }, 150);
    setTimeout(() => {
      discoverFallbackProviders();
      renderWalletOptions();
    }, 700);
  }

  function getInjectedProviders() {
    const byFamily = new Map();
    const seenProviders = new Set();
    Array.from(providerRegistry.values()).forEach((item) => {
      if (!item || !item.provider) return;
      if (seenProviders.has(item.provider)) return;
      seenProviders.add(item.provider);
      const displayName = providerDisplayNameFromMeta(item.provider, item.meta);
      const family = walletFamilyFromMeta(item.provider, item.meta);
      if (!family) return;
      const key = family;
      const priority = item.meta && item.meta.info && item.meta.info.uuid ? 4 : (item.meta && item.meta.info ? 3 : 1);
      const existing = byFamily.get(key);
      if (!existing || priority > existing.priority) {
        byFamily.set(key, { ...item, name: displayName, priority });
      }
    });
    return Array.from(byFamily.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ priority, ...item }) => item);
  }

  function getActiveProvider() {
    return window.__busoutProvider || (getInjectedProviders()[0] && getInjectedProviders()[0].provider) || window.ethereum || null;
  }

  function setStatus(message) {
    document.querySelectorAll('[data-chain-status]').forEach((node) => {
      node.textContent = message || '';
    });
  }

  async function ensureBaseNetwork(provider) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_MAINNET.chainIdHex }] });
    } catch (error) {
      if (error && error.code === 4902) {
        await provider.request({ method: 'wallet_addEthereumChain', params: [BASE_MAINNET] });
      } else {
        throw error;
      }
    }
    const chainIdHex = await provider.request({ method: 'eth_chainId' });
    state.chainId = parseInt(chainIdHex, 16);
  }

  function bindProviderEvents(provider) {
    if (!provider || provider.__busoutBound) return;
    provider.__busoutBound = true;
    if (provider.on) {
      provider.on('accountsChanged', (accounts) => {
        if (!accounts || !accounts.length) {
          state.connected = false;
          state.address = '';
          localStorage.removeItem('busout_wallet_address');
          updateUi();
          openWalletModal();
          return;
        }
        state.address = accounts[0];
        state.connected = true;
        localStorage.setItem('busout_wallet_address', state.address);
        hydratePlayerState().finally(() => {
          updateUi();
          scheduleSync(true);
        });
      });
      provider.on('chainChanged', (chainIdHex) => {
        state.chainId = parseInt(chainIdHex, 16);
        updateUi();
      });
    }
  }

  async function connectWallet(provider, walletName) {
    setStatus('Connecting wallet...');
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      await ensureBaseNetwork(provider);
      const address = accounts && accounts[0];
      if (!address) throw new Error('No wallet address returned.');
      state.address = address;
      state.walletName = walletName;
      state.providerFamily = walletFamilyFromMeta(provider, null) || '';
      state.connected = true;
      window.__busoutProvider = provider;
      localStorage.setItem('busout_wallet_address', address);
      localStorage.setItem('busout_wallet_name', walletName);
      bindProviderEvents(provider);
      await getWalletCapabilities(provider);
      await hydratePlayerState();
      closeWalletModal();
      updateUi();
      scheduleSync(true);
      setStatus('Wallet connected on Base Mainnet.');
    } catch (error) {
      console.error(error);
      setStatus(error && error.message ? error.message : 'Wallet connection failed.');
      showToast(error && error.message ? error.message : 'Wallet connection failed.', 'error');
    }
  }

  async function reconnectSilently() {
    const providers = getInjectedProviders();
    if (!providers.length || !state.address) return;
    for (const item of providers) {
      try {
        const accounts = await item.provider.request({ method: 'eth_accounts' });
        if (accounts && accounts[0] && accounts[0].toLowerCase() === state.address.toLowerCase()) {
          state.connected = true;
          state.walletName = item.name;
          state.providerFamily = walletFamilyFromMeta(item.provider, item.meta) || '';
          window.__busoutProvider = item.provider;
          bindProviderEvents(item.provider);
          await ensureBaseNetwork(item.provider);
          await getWalletCapabilities(item.provider);
          await hydratePlayerState();
          updateUi();
          scheduleSync(true);
          setStatus('Wallet restored.');
          return;
        }
      } catch (_) {}
    }
  }


  function getAtomicSupport(chainCaps) {
    return chainCaps && chainCaps.atomic ? String(chainCaps.atomic.supported || 'unsupported') : 'unsupported';
  }

  function canTryWalletSendCalls(chainCaps) {
    const atomicSupport = getAtomicSupport(chainCaps);
    return !!(chainCaps && (chainCaps.paymasterService && chainCaps.paymasterService.supported || atomicSupport === 'supported' || atomicSupport === 'ready'));
  }

  function isLikelySmartWallet(provider) {
    const providerName = String(state.providerFamily || '').toLowerCase();
    const flags = !!(provider && (provider.isCoinbaseWallet || provider.isCoinbaseBrowser || provider.isCBWallet));
    return flags || providerName === 'basewallet';
  }

  async function sendViaWalletSendCalls(provider, nextTx, opts) {
    const call = {
      to: nextTx.to,
      value: nextTx.value || '0x0',
      data: nextTx.data || '0x'
    };
    const capabilities = {};
    if (opts.paymasterProxyUrl) {
      capabilities.paymasterService = { url: opts.paymasterProxyUrl, context: {} };
    }
    if (opts.suffix && opts.canUseDataSuffixCapability && !hasBuilderSuffix(call.data)) {
      capabilities.dataSuffix = { value: opts.suffix, optional: true };
    }
    const request = {
      version: '2.0.0',
      from: state.address,
      chainId: BASE_MAINNET.chainIdHex,
      atomicRequired: false,
      calls: [call]
    };
    if (Object.keys(capabilities).length) request.capabilities = capabilities;
    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [request]
    });
    return normalizeTransactionResult(result);
  }

  async function sendTransaction(tx) {
    const provider = getActiveProvider();
    if (!provider) throw new Error('No wallet provider found.');
    if (!state.connected || !state.address) throw new Error('Connect your wallet first.');
    await ensureBaseNetwork(provider);

    const capabilities = await getWalletCapabilities(provider);
    const chainCaps = getChainCapabilities(capabilities);
    const paymasterProxyUrl = getPaymasterProxyUrl();
    const suffix = builderSuffixHex();
    const nextTx = {
      from: state.address,
      ...tx,
    };

    const txHasCallData = typeof nextTx.data === 'string' && /^0x/i.test(nextTx.data);
    const canUseDataSuffixCapability = !!(chainCaps && chainCaps.dataSuffix && chainCaps.dataSuffix.supported);
    const canUsePaymaster = !!(paymasterProxyUrl && chainCaps && chainCaps.paymasterService && chainCaps.paymasterService.supported);
    const shouldAttemptWalletSendCalls = canUsePaymaster || canTryWalletSendCalls(chainCaps) || (paymasterProxyUrl && isLikelySmartWallet(provider));

    if (suffix && txHasCallData) {
      nextTx.data = applyBuilderSuffix(nextTx.data, suffix);
    } else if (suffix && canUseDataSuffixCapability) {
      nextTx.dataSuffix = suffix;
    }

    if (canUsePaymaster) {
      try {
        return await sendViaWalletSendCalls(provider, nextTx, {
          paymasterProxyUrl,
          suffix,
          canUseDataSuffixCapability,
        });
      } catch (error) {
        const message = error && error.message ? String(error.message) : '';
        const paymasterServiceIssue = /paymaster|sponsor|userop|entrypoint|bundle|gasless|erc-7677|policy/i.test(message);
        const walletSendCallsParseIssue = /atomic|required|version not supported|missing capability|cannot parse|invalid request|unsupported/i.test(message);
        if (paymasterServiceIssue) {
          throw new Error('Paymaster rejected this transaction. Check that your CDP Paymaster URL is configured and that both the score contract and Base USDC contract are allowlisted in CDP.');
        }
        if (!walletSendCallsParseIssue) {
          throw error;
        }
      }
    }

    if (shouldAttemptWalletSendCalls && !canUsePaymaster) {
      try {
        return await sendViaWalletSendCalls(provider, nextTx, {
          paymasterProxyUrl: '',
          suffix,
          canUseDataSuffixCapability,
        });
      } catch (_) {}
    }

    try {
      return await provider.request({ method: 'eth_sendTransaction', params: [nextTx] });
    } catch (error) {
      const message = error && error.message ? String(error.message) : '';
      const unsupportedDataSuffix = /datasuffix|unknown key|invalid params|unsupported/i.test(message);
      if (suffix && nextTx.dataSuffix && unsupportedDataSuffix) {
        const fallbackTx = { ...nextTx };
        delete fallbackTx.dataSuffix;
        fallbackTx.data = applyBuilderSuffix(fallbackTx.data || '0x', suffix);
        return provider.request({ method: 'eth_sendTransaction', params: [fallbackTx] });
      }
      throw error;
    }
  }

  function safeSetPlayerCash(nextValue) {
    const numeric = Math.max(0, Number(nextValue) || 0);
    window.PlayerCash = numeric;
    state.coins = numeric;
    try {
      if (window.GameData && typeof window.GameData.Save === 'function') {
        window.GameData.Save();
      }
    } catch (_) {}
    updateUi();
    scheduleSync(true);
  }

  function addCoins(amount) {
    safeSetPlayerCash(Number(window.PlayerCash || 0) + Number(amount || 0));
  }

  async function claimRandomBonus() {
    const min = Math.max(1, Number(state.config.bonusMin || DEFAULTS.bonusMin));
    const max = Math.max(min, Number(state.config.bonusMax || DEFAULTS.bonusMax));
    const bonus = Math.floor(Math.random() * (max - min + 1)) + min;
    setStatus(state.config.paymasterEnabled ? 'Open your wallet and approve the sponsored bonus transaction...' : 'Open your wallet and confirm the bonus transaction...');
    try {
      ensureTxBudget();
      const hash = await sendTransaction({
        to: state.config.scoreContract,
        data: encodeSubmitScore(bonus),
        value: '0x0'
      });
      consumeTxBudget();
      addCoins(bonus);
      setStatus('Bonus confirmed: +' + bonus + ' coins' + (hash ? '. Ref: ' + hash.slice(0, 18) + '...' : '.'));
      showToast('+' + bonus + ' coins added', 'success');
      const hint = document.querySelector('[data-bonus-range]');
      if (hint) hint.textContent = 'Last bonus: +' + bonus + ' coins';
    } catch (error) {
      console.error(error);
      const message = error && error.message ? error.message : 'Bonus transaction failed.';
      setStatus(message);
      showToast(message, 'error');
    }
  }

  async function buyCoins(pack) {
    setStatus(state.config.paymasterEnabled ? 'Open your wallet and approve the sponsored purchase transaction...' : 'Open your wallet and confirm the USDC transfer...');
    try {
      ensureTxBudget();
      const rawAmount = BigInt(Math.round(pack.usdc * Math.pow(10, Number(state.config.usdcDecimals || DEFAULTS.usdcDecimals))));
      const hash = await sendTransaction({
        to: state.config.usdcAddress,
        data: encodeTransfer(state.config.storeRecipient, rawAmount),
        value: '0x0'
      });
      consumeTxBudget();
      addCoins(pack.coins);
      setStatus(pack.label + ' purchased' + (hash ? '. Ref: ' + hash.slice(0, 18) + '...' : '.'));
      showToast(pack.label + ' added to your balance', 'success');
      closeStoreModal();
    } catch (error) {
      console.error(error);
      const message = error && error.message ? error.message : 'USDC payment failed.';
      setStatus(message);
      showToast(message, 'error');
    }
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('Leaderboard unavailable right now.');
      const data = await res.json();
      state.leaderboard = Array.isArray(data.items) ? data.items : [];
      state.leaderboardPublishedAt = data.publishedAt || null;
      renderLeaderboardRows();
    } catch (error) {
      console.error(error);
      renderLeaderboardRows(error.message || 'Leaderboard unavailable.');
    }
  }

  async function hydratePlayerState() {
    if (!state.address) return;
    try {
      const res = await fetch('/api/player?address=' + encodeURIComponent(state.address), { cache: 'no-store' });
      if (!res.ok) throw new Error('Player profile unavailable.');
      const data = await res.json();
      const item = data && data.player ? data.player : null;
      state.playerLoaded = true;
      if (item) {
        state.remoteTxSpent = Math.max(0, Number(item.txSpent || 0));
        state.playerVersion = Math.max(0, Number(item.version || 0));
        const remoteCoins = Number(item.coins || 0);
        if (remoteCoins >= 0 && remoteCoins !== Number(window.PlayerCash || 0)) safeSetPlayerCash(remoteCoins);
        if (typeof window.ActiveLevel !== 'undefined' && Number(item.level || 0) >= 0 && Number(window.ActiveLevel || 0) !== Number(item.level || 0)) window.ActiveLevel = Number(item.level || 0);
        state.coins = Number(item.coins || 0);
        state.level = Number(item.level || 0);
        state.txSpent = Math.max(0, Number(item.txSpent || 0));
        state.txRemaining = Math.max(0, Number(item.txRemaining || 0));
      }
      refreshTxBudget();
      updateUi();
      if (!state.playerSyncTimer) {
        state.playerSyncTimer = setInterval(function () {
          if (state.connected && state.address) hydratePlayerState();
        }, 8000);
      }
    } catch (error) {
      console.warn(error);
      state.playerLoaded = true;
      refreshTxBudget();
    }
  }

  function scheduleSync(force) {
    if (!state.connected || !state.address) return;
    if (!force && state.coins === state.lastSyncedCoins) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(async () => {
      try {
        const payload = {
          address: state.address,
          coins: state.coins,
          level: state.level,
          txSpent: state.txSpent,
          txRemaining: state.txRemaining,
          txAllowed: getAllowedTxCount(),
          walletName: state.walletName,
          knownVersion: state.playerVersion || 0
        };
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          state.lastSyncedCoins = state.coins;
          const data = await res.json().catch(() => null);
          if (data && data.publishedAt) state.leaderboardPublishedAt = data.publishedAt;
          if (data && data.saved) {
            state.playerVersion = Math.max(state.playerVersion || 0, Number(data.saved.version || 0));
            if (data.stale) hydratePlayerState();
          }
          if (document.getElementById('chain-leaderboard-modal') && !document.getElementById('chain-leaderboard-modal').classList.contains('chain-hidden')) {
            fetchLeaderboard();
          }
        }
      } catch (error) {
        console.error('score sync failed', error);
      }
    }, force ? 250 : 1500);
  }

  function readGameState() {
    const coins = Number(window.PlayerCash || 0);
    const level = Number(window.ActiveLevel || 0);
    const changed = coins !== state.coins || level !== state.level;
    state.coins = Number.isFinite(coins) ? coins : 0;
    state.level = Number.isFinite(level) ? level : 0;
    refreshTxBudget();
    if (changed) {
      updateUi();
      scheduleSync(false);
    }
  }

  function controlsVisible() {
    return state.connected && state.hasEnteredGame;
  }

  function updateUi() {
    refreshTxBudget();
    const visible = controlsVisible();
    document.querySelectorAll('[data-wallet-address]').forEach((el) => {
      el.textContent = state.connected ? maskAddress(state.address) : 'Wallet locked';
    });
    document.querySelectorAll('[data-wallet-network]').forEach((el) => {
      el.textContent = state.chainId === BASE_MAINNET.chainId ? ('Tx left ' + state.txRemaining) : 'Base required';
    });
    document.querySelectorAll('[data-tx-remaining]').forEach((el) => {
      el.textContent = 'Tx left: ' + state.txRemaining + ' / ' + getAllowedTxCount();
    });
    document.querySelectorAll('[data-top-connect]').forEach((el) => {
      el.textContent = state.connected ? 'Switch Wallet' : 'Connect Wallet';
    });
    document.querySelectorAll('[data-open-leaderboard]').forEach((el) => {
      el.classList.toggle('chain-hidden', !state.connected);
    });
    document.querySelectorAll('[data-open-store]').forEach((el) => {
      el.classList.toggle('chain-hidden', !state.connected);
    });
    const desktopTop = document.querySelector('.chain-desktop-top');
    const leftStore = document.querySelector('.chain-left-store');
    const mobileTrigger = document.querySelector('.chain-mobile-trigger-wrap');
    if (desktopTop) desktopTop.classList.toggle('chain-hidden', !visible || isMobileViewport());
    if (leftStore) leftStore.classList.toggle('chain-hidden', !visible || isMobileViewport());
    if (mobileTrigger) mobileTrigger.classList.toggle('chain-hidden', !visible || !isMobileViewport());
    const mobileMenu = document.getElementById('chain-mobile-menu');
    if (mobileMenu) {
      const mobileMenuVisible = visible && isMobileViewport() && state.mobileMenuOpen;
      mobileMenu.classList.toggle('open', mobileMenuVisible);
      mobileMenu.classList.toggle('chain-hidden', !mobileMenuVisible);
    }
    const gate = document.getElementById('chain-gate');
    if (gate) gate.classList.toggle('chain-hidden', !!state.connected);
    const builderReady = !!getBuilderCode();
    const paymasterReady = !!state.config.paymasterEnabled;
    const statusText = builderReady ? ('Builder code active' + (paymasterReady ? ' · Paymaster configured' : '')) : 'Builder code missing';
    document.querySelectorAll('[data-builder-status]').forEach((el) => { el.textContent = statusText; });
  }

  function openWalletModal() {
    document.getElementById('chain-wallet-modal').classList.remove('chain-hidden');
    state.mobileMenuOpen = false;
    renderWalletOptions();
    updateUi();
  }
  function closeWalletModal() { document.getElementById('chain-wallet-modal').classList.add('chain-hidden'); updateUi(); }
  function openStoreModal() {
    document.getElementById('chain-store-modal').classList.remove('chain-hidden');
    state.mobileMenuOpen = false;
    updateUi();
  }
  function closeStoreModal() { document.getElementById('chain-store-modal').classList.add('chain-hidden'); }
  function openLeaderboard() {
    document.getElementById('chain-leaderboard-modal').classList.remove('chain-hidden');
    state.mobileMenuOpen = false;
    fetchLeaderboard();
    updateUi();
  }
  function closeLeaderboard() { document.getElementById('chain-leaderboard-modal').classList.add('chain-hidden'); }
  function toggleMobileMenu() {
    state.mobileMenuOpen = !state.mobileMenuOpen;
    updateUi();
  }

  function renderWalletOptions() {
    const wrap = document.querySelector('[data-wallet-options]');
    if (!wrap) return;
    wrap.innerHTML = '';
    const providers = getInjectedProviders();
    const subtitle = document.querySelector('[data-wallet-modal-subtitle]');
    if (subtitle) {
      subtitle.textContent = providers.length
        ? (providers.length + ' compatible wallet' + (providers.length === 1 ? '' : 's') + ' detected on this device')
        : 'No supported injected wallet detected yet';
    }
    if (!providers.length) {
      wrap.innerHTML = '<div class="chain-mini-text">No injected wallet detected yet. Open MetaMask, Rabby, OKX, Trust Wallet, Bitget, Base Wallet or Coinbase Wallet, then reload if needed.</div>';
      return;
    }
    providers.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'chain-wallet-item';
      div.innerHTML = '<div class="chain-wallet-icon">' + item.name.slice(0, 1) + '</div><div class="chain-wallet-copy"><div class="chain-wallet-name">' + item.name + '</div><div class="chain-wallet-sub">Connect and switch to Base Mainnet</div></div>';
      div.addEventListener('click', () => connectWallet(item.provider, item.name));
      wrap.appendChild(div);
    });
  }

  function renderStoreCards() {
    const wrap = document.querySelector('[data-store-grid]');
    const freeTitle = document.querySelector('[data-free-title]');
    const freeHint = document.querySelector('[data-free-hint]');
    if (freeTitle) freeTitle.textContent = 'Click for free random coin';
    if (freeHint) freeHint.textContent = 'Approve one onchain action to receive a random bonus between ' + state.config.bonusMin + ' and ' + state.config.bonusMax + ' coins.';
    if (!wrap) return;
    wrap.innerHTML = '';
    (state.config.packs || DEFAULTS.packs).forEach((pack) => {
      const card = document.createElement('div');
      card.className = 'chain-store-card';
      card.innerHTML = [
        '<div style="font-size:26px; color:#173252;">' + pack.label + '</div>',
        '<div class="chain-mini-text">Base ' + state.config.usdcSymbol + ' payment</div>',
        '<div style="font-size:18px; color:#173252;">' + pack.priceLabel + '</div>',
        '<button class="chain-store-buy" type="button">Buy now</button>'
      ].join('');
      card.querySelector('button').addEventListener('click', () => buyCoins(pack));
      wrap.appendChild(card);
    });
  }

  function renderLeaderboardRows(errorMessage) {
    const wrap = document.querySelector('[data-leaderboard-rows]');
    const meta = document.querySelector('[data-leaderboard-meta]');
    if (!wrap) return;
    if (meta) meta.textContent = state.leaderboardPublishedAt ? ('Live ranking · ' + new Date(state.leaderboardPublishedAt).toLocaleString()) : 'Live ranking';
    if (errorMessage) { wrap.innerHTML = '<div class="chain-mini-text">' + errorMessage + '</div>'; return; }
    if (Number(state.coins || 0) < LEADERBOARD_UNLOCK_GOLD) {
      wrap.innerHTML = ['<div class="chain-lock-card">','<div style="font-size:26px;">Leaderboard Locked</div>','<div class="chain-mini-text">You need at least ' + formatCoins(LEADERBOARD_UNLOCK_GOLD) + ' gold to unlock the leaderboard.</div>','<div class="chain-mini-text">Your current gold: ' + formatCoins(state.coins || 0) + '</div>','</div>'].join('');
      return;
    }
    if (!state.leaderboard.length) { wrap.innerHTML = '<div class="chain-mini-text">No leaderboard data yet.</div>'; return; }
    wrap.innerHTML = '';
    state.leaderboard.slice(0, LEADERBOARD_LIMIT).forEach(function (item, index) {
      const row = document.createElement('div');
      row.className = 'chain-rank-row' + (state.address && item.address && item.address.toLowerCase() === state.address.toLowerCase() ? ' me' : '');
      row.innerHTML = ['<div>#' + (index + 1) + '</div>','<div><div>' + (item.maskedAddress || maskAddress(item.address || '')) + '</div></div>','<div class="chain-rank-score">' + formatCoins(item.coins || 0) + '</div>'].join('');
      wrap.appendChild(row);
    });
  }

  function loadConfig() {
    return fetch('/api/config', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        state.config = {
          ...state.config,
          ...data,
          txPerLevel: Number(data.txPerLevel || state.config.txPerLevel),
          bonusMin: Number(data.bonusMin || state.config.bonusMin),
          bonusMax: Number(data.bonusMax || state.config.bonusMax),
          packs: Array.isArray(data.packs) && data.packs.length ? data.packs : state.config.packs,
          paymasterEnabled: !!data.paymasterEnabled,
          paymasterProxyPath: String(data.paymasterProxyPath || state.config.paymasterProxyPath || '/api/paymaster-proxy'),
          paymasterMode: String(data.paymasterMode || state.config.paymasterMode || 'disabled'),
        };
        if (state.config.builderCode) localStorage.setItem('busout_builder_code', state.config.builderCode);
        renderStoreCards();
        updateUi();
      })
      .catch((err) => console.warn('config load failed', err));
  }

  function maybeMarkGameEntered(evt) {
    if (!state.connected || state.hasEnteredGame) return;
    const gateVisible = !document.getElementById('chain-gate').classList.contains('chain-hidden');
    const walletOpen = !document.getElementById('chain-wallet-modal').classList.contains('chain-hidden');
    const storeOpen = !document.getElementById('chain-store-modal').classList.contains('chain-hidden');
    const boardOpen = !document.getElementById('chain-leaderboard-modal').classList.contains('chain-hidden');
    if (gateVisible || walletOpen || storeOpen || boardOpen) return;
    const t = evt.target;
    if (t && (t.closest && t.closest('#chain-ui-root'))) return;
    state.hasEnteredGame = true;
    updateUi();
  }

  function buildUi() {
    const root = document.getElementById('chain-ui-root');
    if (!root) return;
    root.innerHTML = [
      '<div class="chain-safe-wrap">',
      '  <div class="chain-left-store chain-hidden">',
      '    <button class="chain-btn green chain-store-btn chain-hidden" data-open-store>Store</button>',
      '  </div>',
      '  <div class="chain-desktop-top chain-hidden">',
      '    <div class="chain-stack">',
      '      <div class="chain-card"><div class="addr" data-wallet-address>Wallet locked</div><div class="meta" data-wallet-network>Base required</div></div>',
      '      <div class="chain-row">',
      '        <button class="chain-mini-btn chain-hidden" data-open-leaderboard>Leaderboard</button>',
      '        <button class="chain-btn" data-top-connect>Connect Wallet</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="chain-mobile-trigger-wrap chain-hidden">',
      '    <button class="chain-menu-trigger" type="button" data-mobile-menu-trigger><span></span><span></span><span></span></button>',
      '  </div>',
      '  <div class="chain-mobile-menu chain-hidden" id="chain-mobile-menu">',
      '    <div class="chain-mobile-panel">',
      '      <button class="chain-btn green chain-hidden" data-open-store>Store</button>',
      '      <button class="chain-mini-btn chain-hidden" data-open-leaderboard>Leaderboard</button>',
      '      <div class="chain-card"><div class="addr" data-wallet-address>Wallet locked</div><div class="meta" data-wallet-network>Base required</div></div>',
      '      <button class="chain-btn" data-top-connect>Connect Wallet</button>',
      '    </div>',
      '  </div>',
      '  <div class="chain-gate" id="chain-gate">',
      '    <div class="chain-gate-card">',
      '      <div class="chain-modal-head"><div><h2 class="chain-title">Connect Wallet</h2><p class="chain-subtitle">Connect a Base-compatible wallet before starting the game.</p></div></div>',
      '      <div class="chain-modal-body">',
      '        <div class="chain-note-panel">',
      '          <div class="chain-note-row"><div class="chain-inline-icon">1</div><div><div>Play gate on Base</div><div class="chain-mini-text">Standard web app wallet flow for Base Mainnet.</div></div></div>',
      '          <div class="chain-note-row" style="margin-bottom:0;"><div class="chain-inline-icon">2</div><div><div>Store + onchain actions</div><div class="chain-mini-text">Bonus claim and USDC purchase flow added.</div></div></div>',
      '        </div>',
      '        <div style="margin-top:16px;"><button class="chain-btn" style="width:100%;" data-gate-open-wallet>Choose Wallet</button></div>',
      '        <div class="chain-status" data-chain-status></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="chain-modal-backdrop chain-hidden" id="chain-wallet-modal">',
      '    <div class="chain-modal">',
      '      <div class="chain-modal-head"><div><h3 class="chain-title">Choose Wallet</h3><p class="chain-subtitle" data-wallet-modal-subtitle>' + DEFAULTS.walletModalSubtitle + '</p></div><button class="chain-close" data-close-wallet>×</button></div>',
      '      <div class="chain-modal-body">',
      '        <div class="chain-two-col">',
      '          <div><div class="chain-wallet-grid" data-wallet-options></div></div>',
      '          <div class="chain-note-panel">',
      '            <div class="chain-note-row"><div class="chain-inline-icon">B</div><div><div>Base ready</div><div class="chain-mini-text">The app will request a switch to Base Mainnet when you connect.</div></div></div>',
      '            <div class="chain-note-row"><div class="chain-inline-icon">W</div><div><div>Wallet identity</div><div class="chain-mini-text">Detected wallet address is used as player identity.</div></div></div>',
      '            <div class="chain-note-row"><div class="chain-inline-icon">T</div><div><div>Tx budget</div><div class="chain-mini-text">Per-level transaction quota accumulates and decreases as you use it.</div></div></div>',
      '            <div class="chain-note-row" style="margin-bottom:0;"><div class="chain-inline-icon">C</div><div><div>Builder code</div><div class="chain-mini-text" data-builder-status>Builder code missing</div></div></div>',
      '            <div class="chain-status" data-chain-status></div>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="chain-modal-backdrop chain-hidden" id="chain-store-modal">',
      '    <div class="chain-modal chain-store-modal" style="width:min(92vw, 780px);">',
      '      <div class="chain-modal-head"><div><h3 class="chain-title">Store</h3><p class="chain-subtitle">Random bonus + Base USDC coin packs</p></div><button class="chain-close" data-close-store>×</button></div>',
      '      <div class="chain-modal-body">',
      '        <div class="chain-free-card">',
      '          <div style="font-size:24px; color:#173252;" data-free-title>Click for free random coin</div>',
      '          <div class="chain-mini-text" data-free-hint>Approve one onchain action to receive a random bonus.</div>',
      '          <button class="chain-free-button" type="button" data-random-bonus>Claim 50-100 Bonus</button>',
      '          <div class="chain-mini-text" data-bonus-range>Random bonus range: 50-100 coins</div>',
      '        </div>',
      '        <div class="chain-store-grid" data-store-grid></div>',
      '        <div class="chain-status-row"><div class="chain-tx-pill" data-tx-remaining>Tx left: 20 / 20</div></div>',
      '        <div class="chain-status" data-chain-status></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div id="chain-toast-wrap" class="chain-toast-wrap"></div>',
      '  <div class="chain-modal-backdrop chain-hidden" id="chain-leaderboard-modal">',
      '    <div class="chain-modal" style="width:min(92vw, 760px);">',
      '      <div class="chain-modal-head"><div><h3 class="chain-title">Top 20 Leaderboard</h3><p class="chain-subtitle" data-leaderboard-meta>Live ranking</p></div><button class="chain-close" data-close-leaderboard>×</button></div>',
      '      <div class="chain-modal-body rank-body">',
      '        <div class="chain-rank-list" data-leaderboard-rows></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    document.querySelectorAll('[data-top-connect]').forEach((el) => el.addEventListener('click', openWalletModal));
    document.querySelector('[data-gate-open-wallet]').addEventListener('click', openWalletModal);
    document.querySelector('[data-close-wallet]').addEventListener('click', closeWalletModal);
    document.querySelector('[data-close-store]').addEventListener('click', closeStoreModal);
    document.querySelector('[data-close-leaderboard]').addEventListener('click', closeLeaderboard);
    document.querySelectorAll('[data-open-store]').forEach((el) => el.addEventListener('click', openStoreModal));
    document.querySelectorAll('[data-open-leaderboard]').forEach((el) => el.addEventListener('click', openLeaderboard));
    document.querySelector('[data-random-bonus]').addEventListener('click', claimRandomBonus);
    document.querySelector('[data-mobile-menu-trigger]').addEventListener('click', toggleMobileMenu);
    document.getElementById('chain-wallet-modal').addEventListener('click', (e) => { if (e.target.id === 'chain-wallet-modal') closeWalletModal(); });
    document.getElementById('chain-store-modal').addEventListener('click', (e) => { if (e.target.id === 'chain-store-modal') closeStoreModal(); });
    document.getElementById('chain-leaderboard-modal').addEventListener('click', (e) => { if (e.target.id === 'chain-leaderboard-modal') closeLeaderboard(); });
    window.addEventListener('resize', () => { if (!isMobileViewport()) state.mobileMenuOpen = false; updateUi(); });
    document.addEventListener('pointerdown', maybeMarkGameEntered, true);
    document.addEventListener('touchstart', maybeMarkGameEntered, true);
    renderStoreCards();
    state.uiReady = true;
  }

  injectStyles();
  buildUi();
  setupProviderDiscovery();
  loadConfig().finally(() => {
    updateUi();
    renderWalletOptions();
    reconnectSilently();
  });
  setInterval(readGameState, 1200);
})();
