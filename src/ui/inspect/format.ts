import { SOL } from '../../sim/analyze';
import type { TokenInfo } from '../../sim/jupApi';
import { WSOL_MINT } from '../../sim/programs';

export const shortAddress = (address: string, chars = 4) =>
  address.length > chars * 2 + 1 ? `${address.slice(0, chars)}…${address.slice(-chars)}` : address;

// Formats a raw integer amount with its decimals, keeping `significant` digits after the leading
// ones for small values and at most `maxFraction` decimals otherwise.
export function formatAmount(raw: bigint, decimals: number, { maxFraction = 4, signed = false } = {}) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0');
  if (whole === 0n && abs !== 0n) {
    // Small amounts: keep 4 significant digits.
    const firstNonZero = fraction.search(/[1-9]/);
    fraction = fraction.slice(0, Math.max(maxFraction, firstNonZero + 4));
  } else {
    fraction = fraction.slice(0, maxFraction);
  }
  fraction = fraction.replace(/0+$/, '');
  const wholeText = whole.toLocaleString('en-US');
  const sign = negative ? '−' : signed && abs !== 0n ? '+' : '';
  return `${sign}${wholeText}${fraction ? `.${fraction}` : ''}`;
}

export function formatUsd(value: number | undefined, { signed = false } = {}) {
  if (value === undefined || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  return `${sign}$${text}`;
}

export function formatBps(bps: number | undefined) {
  if (bps === undefined || !Number.isFinite(bps)) return '';
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  const abs = Math.abs(bps);
  return `${sign}${abs >= 100 ? abs.toFixed(0) : abs.toFixed(1)} bps`;
}

export const formatPct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

export function symbolOf(mint: string, tokens: Record<string, TokenInfo>) {
  if (mint === SOL) return 'SOL';
  if (mint === WSOL_MINT) return 'wSOL';
  return tokens[mint]?.symbol ?? shortAddress(mint);
}

export function iconOf(mint: string, tokens: Record<string, TokenInfo>) {
  return tokens[mint === SOL ? WSOL_MINT : mint]?.icon;
}

export const lamportsToSol = (lamports: bigint) => formatAmount(lamports, 9, { maxFraction: 6 });

// Signed values: negative red, positive green, zero in the normal text colour.
export const toneOf = (value: number | bigint | undefined) =>
  value === undefined ? '' : value > 0 ? 'text-pos' : value < 0 ? 'text-neg' : '';

export function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}

// JSON.stringify replacer for analysis objects (bigints and byte arrays).
export const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('base64')
      : value instanceof Map
        ? Object.fromEntries(value)
        : value;

export const explorerAddress = (address: string) => `https://explorer.solana.com/address/${address}`;
