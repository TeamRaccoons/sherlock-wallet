import type { Instr } from './analyze';
import type { NormalizedIdl } from './idl';
import type { LogFailure } from './logs';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './programs';

// Anchor framework errors most often hit while poking at someone else's dapp.
const ANCHOR_ERRORS: Record<number, string> = {
  100: 'InstructionMissing',
  101: 'InstructionFallbackNotFound',
  102: 'InstructionDidNotDeserialize',
  2000: 'ConstraintMut',
  2001: 'ConstraintHasOne',
  2002: 'ConstraintSigner',
  2003: 'ConstraintRaw',
  2006: 'ConstraintSeeds',
  2012: 'ConstraintAddress',
  2014: 'ConstraintTokenMint',
  2500: 'RequireViolated',
  2501: 'RequireEqViolated',
  2502: 'RequireKeysEqViolated',
  2503: 'RequireNeqViolated',
  2504: 'RequireKeysNeqViolated',
  2505: 'RequireGtViolated',
  2506: 'RequireGteViolated',
  2015: 'ConstraintTokenOwner',
  3001: 'AccountDiscriminatorNotFound',
  3002: 'AccountDiscriminatorMismatch',
  3003: 'AccountDidNotDeserialize',
  3005: 'AccountNotEnoughKeys',
  3007: 'AccountOwnedByWrongProgram',
  3010: 'AccountNotSigner',
  3012: 'AccountNotInitialized',
};

const TOKEN_ERRORS: Record<number, string> = {
  0: 'NotRentExempt',
  1: 'InsufficientFunds',
  2: 'InvalidMint',
  3: 'MintMismatch',
  4: 'OwnerMismatch',
  5: 'FixedSupply',
  6: 'AlreadyInUse',
  11: 'UninitializedState',
  13: 'NativeNotSupported',
  14: 'NonNativeHasBalance',
  17: 'AccountFrozen',
};

// Transaction-level errors, raised before any instruction runs.
const TX_ERRORS: Record<string, string> = {
  AccountNotFound: 'The fee payer has no SOL account (it was never funded)',
  InsufficientFundsForFee: 'The fee payer cannot cover the transaction fee',
  InsufficientFundsForRent: 'An account would be left below the rent-exempt minimum',
  BlockhashNotFound: 'Blockhash not found',
  AddressLookupTableNotFound: 'An address lookup table does not exist',
  InvalidAddressLookupTableIndex: 'An address lookup table index is out of range',
  WouldExceedMaxAccountCostLimit: 'A written account is at its per-block compute limit',
  MaxLoadedAccountsDataSizeExceeded: 'Loaded account data exceeds the limit',
};

export type ErrorDescription = {
  text: string;
  programId?: string;
  name?: string;
  msg?: string;
  customCode?: number;
  location?: string;
  account?: string;
  left?: string;
  right?: string;
};

export function describeError(
  err: unknown,
  failure: LogFailure | undefined,
  idls: Map<string, NormalizedIdl | null>,
  instructions: Instr[],
  labels: Record<string, string>
): ErrorDescription {
  let ixIndex: number | undefined;
  let custom: number | undefined;
  let kind: string | undefined;
  if (err && typeof err === 'object' && 'InstructionError' in err) {
    const [index, detail] = (err as any).InstructionError as [number, unknown];
    ixIndex = index;
    if (detail && typeof detail === 'object' && 'Custom' in detail) custom = (detail as any).Custom;
    else kind = typeof detail === 'string' ? detail : JSON.stringify(detail);
  } else {
    kind = typeof err === 'string' ? (TX_ERRORS[err] ? `${err}: ${TX_ERRORS[err]}` : err) : JSON.stringify(err);
  }

  // The failing program is the innermost one in the logs; the error's instruction index only
  // points at the top-level call.
  const programId = failure?.programId ?? (ixIndex !== undefined ? instructions[ixIndex]?.programId : undefined);
  custom ??= failure?.customCode;
  let name: string | undefined;
  let msg: string | undefined;
  if (custom !== undefined && programId) {
    const fromIdl = idls.get(programId)?.errors.get(custom);
    name = fromIdl?.name;
    msg = fromIdl?.msg;
    if (!name && (programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM)) name = TOKEN_ERRORS[custom];
    if (!name) name = ANCHOR_ERRORS[custom];
  }
  // The program's own log is the most precise source when it is an Anchor error.
  const anchor = failure?.anchor;
  if (anchor && (custom === undefined || anchor.number === custom)) {
    name ??= anchor.code;
    msg ??= anchor.message;
  }

  const where = ixIndex !== undefined ? `instruction #${ixIndex + 1}` : 'transaction';
  const program = programId ? (labels[programId] ?? programId) : undefined;
  const what =
    name ??
    (custom !== undefined
      ? `custom error ${custom} (0x${custom.toString(16)})`
      : (kind ?? failure?.message ?? 'unknown error'));
  const text = `${what}${msg ? `: ${msg}` : ''} — ${program ? `${program}, ` : ''}${where}`;
  return {
    text,
    programId,
    name,
    msg,
    customCode: custom,
    location: anchor?.location,
    account: anchor?.account,
    left: anchor?.left,
    right: anchor?.right,
  };
}
