import { Reader } from './borsh';
import type { DecodedInstruction } from './idl';
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  MEMO_V1_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from './programs';

export const BUILTIN_PROGRAMS = new Set([
  COMPUTE_BUDGET_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  ATA_PROGRAM,
  MEMO_PROGRAM,
  MEMO_V1_PROGRAM,
]);

function computeBudget(data: Uint8Array): DecodedInstruction | undefined {
  const r = new Reader(data);
  switch (r.u8()) {
    case 1:
      return { name: 'RequestHeapFrame', args: { bytes: r.u32() } };
    case 2:
      return { name: 'SetComputeUnitLimit', args: { units: r.u32() } };
    case 3:
      return { name: 'SetComputeUnitPrice', args: { microLamports: r.u64() } };
    case 4:
      return { name: 'SetLoadedAccountsDataSizeLimit', args: { bytes: r.u32() } };
  }
}

function system(data: Uint8Array): DecodedInstruction | undefined {
  const r = new Reader(data);
  switch (r.u32()) {
    case 0:
      return {
        name: 'CreateAccount',
        args: { lamports: r.u64(), space: r.u64(), owner: r.pubkey() },
        accountNames: ['funder', 'newAccount'],
      };
    case 1:
      return { name: 'Assign', args: { owner: r.pubkey() }, accountNames: ['account'] };
    case 2:
      return { name: 'Transfer', args: { lamports: r.u64() }, accountNames: ['from', 'to'] };
    case 3:
      return { name: 'CreateAccountWithSeed', accountNames: ['funder', 'newAccount', 'base'] };
    case 4:
      return { name: 'AdvanceNonceAccount', accountNames: ['nonceAccount', 'recentBlockhashes', 'nonceAuthority'] };
    case 8:
      return { name: 'Allocate', args: { space: r.u64() }, accountNames: ['account'] };
  }
}

function token(data: Uint8Array): DecodedInstruction | undefined {
  const r = new Reader(data);
  switch (r.u8()) {
    case 1:
      return { name: 'InitializeAccount', accountNames: ['account', 'mint', 'owner', 'rent'] };
    case 3:
      return { name: 'Transfer', args: { amount: r.u64() }, accountNames: ['source', 'destination', 'authority'] };
    case 4:
      return { name: 'Approve', args: { amount: r.u64() }, accountNames: ['source', 'delegate', 'owner'] };
    case 5:
      return { name: 'Revoke', accountNames: ['source', 'owner'] };
    case 6: {
      const authorityType = ['MintTokens', 'FreezeAccount', 'AccountOwner', 'CloseAccount'][r.u8()] ?? 'Other';
      const newAuthority = r.u8() ? r.pubkey() : null;
      return {
        name: 'SetAuthority',
        args: { authorityType, newAuthority },
        accountNames: ['account', 'currentAuthority'],
      };
    }
    case 7:
      return { name: 'MintTo', args: { amount: r.u64() }, accountNames: ['mint', 'account', 'authority'] };
    case 8:
      return { name: 'Burn', args: { amount: r.u64() }, accountNames: ['account', 'mint', 'authority'] };
    case 9:
      return { name: 'CloseAccount', accountNames: ['account', 'destination', 'owner'] };
    case 12:
      return {
        name: 'TransferChecked',
        args: { amount: r.u64(), decimals: r.u8() },
        accountNames: ['source', 'mint', 'destination', 'authority'],
      };
    case 13:
      return {
        name: 'ApproveChecked',
        args: { amount: r.u64(), decimals: r.u8() },
        accountNames: ['source', 'mint', 'delegate', 'owner'],
      };
    case 17:
      return { name: 'SyncNative', accountNames: ['account'] };
    case 18:
      return { name: 'InitializeAccount3', args: { owner: r.pubkey() }, accountNames: ['account', 'mint'] };
  }
}

function ata(data: Uint8Array): DecodedInstruction | undefined {
  const names = ['funder', 'associatedAccount', 'wallet', 'mint', 'systemProgram', 'tokenProgram'];
  if (data.length === 0 || data[0] === 0) return { name: 'Create', accountNames: names };
  if (data[0] === 1) return { name: 'CreateIdempotent', accountNames: names };
}

export function decodeBuiltin(programId: string, data: Uint8Array): DecodedInstruction | undefined {
  try {
    switch (programId) {
      case COMPUTE_BUDGET_PROGRAM:
        return computeBudget(data);
      case SYSTEM_PROGRAM:
        return system(data);
      case TOKEN_PROGRAM:
      case TOKEN_2022_PROGRAM:
        return token(data);
      case ATA_PROGRAM:
        return ata(data);
      case MEMO_PROGRAM:
      case MEMO_V1_PROGRAM:
        return { name: 'Memo', args: { text: new TextDecoder().decode(data) } };
    }
  } catch {
    return undefined;
  }
}
