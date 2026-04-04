const { resolveBuilderCode, resolvePaymasterUrl } = require('./runtime-config');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const paymasterUrl = resolvePaymasterUrl();

  res.end(JSON.stringify({
    builderCode: resolveBuilderCode(),
    txPerLevel: Number(process.env.BUSOUT_TX_PER_LEVEL || 20),
    bonusMin: Number(process.env.BUSOUT_BONUS_MIN || 50),
    bonusMax: Number(process.env.BUSOUT_BONUS_MAX || 100),
    paymasterEnabled: !!paymasterUrl,
    paymasterProxyPath: '/api/paymaster-proxy',
    paymasterMode: paymasterUrl ? 'wallet_sendCalls' : 'disabled',
    storeRecipient: '0xe8Bda2Ed9d2FC622D900C8a76dc455A3e79B041f',
    scoreContract: '0xD2DF0E19d481690C505Ad79baBE403A1038248B7',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    usdcSymbol: 'USDC'
  }));
};
