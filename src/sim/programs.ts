import { BUNDLED_IDLS } from './idls';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_V1_PROGRAM = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
export const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export const LAMPORTS_PER_SIGNATURE = 5000;
export const DEFAULT_CU_PER_INSTRUCTION = 200_000;
export const MAX_CU_LIMIT = 1_400_000;
export const DEFAULT_LOADED_ACCOUNTS_DATA_LIMIT = 64 * 1024 * 1024;

// Legacy and v0 messages stay at the packet size; v1 messages (SIMD-0296/0385) may be up to 4 KiB.
export function maxTransactionSize(version: TxVersion) {
  return version === 1 ? 4096 : 1232;
}
export type TxVersion = 'legacy' | 0 | 1 | 'unknown';

export const KNOWN_PROGRAMS: Record<string, string> = {
  [SYSTEM_PROGRAM]: 'System',
  [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget',
  [TOKEN_PROGRAM]: 'Token',
  [TOKEN_2022_PROGRAM]: 'Token-2022',
  [ATA_PROGRAM]: 'Associated Token',
  [MEMO_PROGRAM]: 'Memo',
  [MEMO_V1_PROGRAM]: 'Memo v1',
  [JUPITER_V6]: 'Jupiter v6',
  AddressLookupTab1e1111111111111111111111111: 'Address Lookup Table',
  Stake11111111111111111111111111111111111111: 'Stake',
  Vote111111111111111111111111111111111111111: 'Vote',
  BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
  Sysvar1nstructions1111111111111111111111111: 'Sysvar: Instructions',
  SysvarC1ock11111111111111111111111111111111: 'Sysvar: Clock',
  SysvarRent111111111111111111111111111111111: 'Sysvar: Rent',
  PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu: 'Jupiter Perps',
  '61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH': 'JupiterZ (RFQ)',
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: 'Kamino Lend',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpool',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM',
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: 'Meteora DAMM v2',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'Meteora DAMM v1',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'Pump.fun AMM',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: 'Phoenix',
  MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms: 'Manifest',
  ...Object.fromEntries(Object.entries(BUNDLED_IDLS).map(([id, { name }]) => [id, name])),
};

export const JITO_TIP_ACCOUNTS = new Set([
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]);

export const isTokenProgram = (id: string) => id === TOKEN_PROGRAM || id === TOKEN_2022_PROGRAM;
