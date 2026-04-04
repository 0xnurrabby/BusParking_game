const BUILDER_CODE_PLACEHOLDER = 'PASTE_YOUR_BUILDER_CODE_HERE';
const PAYMASTER_URL_PLACEHOLDER = 'PASTE_YOUR_CDP_PAYMASTER_URL_HERE';

function cleanString(value) {
  return String(value || '').trim();
}

function resolveBuilderCode() {
  const value = cleanString(process.env.BUSOUT_BUILDER_CODE || 'bc_gcr4i5kz');
  return value && value !== BUILDER_CODE_PLACEHOLDER ? value : '';
}

function resolvePaymasterUrl() {
  const value = cleanString(
    process.env.CDP_PAYMASTER_URL ||
    process.env.PAYMASTER_PROXY_TARGET ||
    ''
  );
  return value && value !== PAYMASTER_URL_PLACEHOLDER ? value : '';
}

module.exports = {
  BUILDER_CODE_PLACEHOLDER,
  PAYMASTER_URL_PLACEHOLDER,
  resolveBuilderCode,
  resolvePaymasterUrl,
};
