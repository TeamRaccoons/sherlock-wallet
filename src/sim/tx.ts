import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  transactionConfigMaskHasComputeUnitLimit,
  transactionConfigMaskHasHeapSize,
  transactionConfigMaskHasLoadedAccountsDataSizeLimit,
  transactionConfigMaskHasPriorityFee,
} from '@solana/kit';
import bs58 from 'bs58';
import type { TxVersion } from './programs';

// One shape for every transaction format (legacy, v0 and v1, decoded by @solana/kit), so the
// analysis does not care which one it got.
export type ParsedInstruction = {
  programIdIndex: number;
  accountKeyIndexes: number[];
  data: Uint8Array;
  // Offset of `data` in the serialized transaction, when known (v1), to patch it in place.
  dataOffset?: number;
};

// v1 transactions carry their compute budget in the header instead of compute budget instructions
// (SIMD-0385). Unset fields take the minimum: no priority fee, and zero compute units and zero
// loaded-data bytes budgeted, which fails at execution.
export type V1Config = {
  mask: number;
  priorityFeeLamports?: bigint;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
  heapSize?: number;
};

export type ParsedTransaction = {
  version: TxVersion;
  header: { numRequiredSignatures: number; numReadonlySigned: number; numReadonlyUnsigned: number };
  staticKeys: string[];
  recentBlockhash: string;
  instructions: ParsedInstruction[];
  lookups: { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[];
  config?: V1Config;
};

export const V1_VERSION_BYTE = 129;

function v1Config(mask: number, values: readonly { kind: string; value: number | bigint }[]): V1Config {
  // Values appear in bit order: priority fee (bits 0-1, u64), compute limit, loaded data, heap.
  const queue = [...values];
  const next = () => queue.shift()?.value;
  const config: V1Config = { mask };
  if (transactionConfigMaskHasPriorityFee(mask)) config.priorityFeeLamports = BigInt(next() ?? 0);
  if (transactionConfigMaskHasComputeUnitLimit(mask)) config.computeUnitLimit = Number(next());
  if (transactionConfigMaskHasLoadedAccountsDataSizeLimit(mask)) config.loadedAccountsDataSizeLimit = Number(next());
  if (transactionConfigMaskHasHeapSize(mask)) config.heapSize = Number(next());
  return config;
}

export function parseTransaction(bytes: Uint8Array): ParsedTransaction | undefined {
  try {
    const { messageBytes } = getTransactionDecoder().decode(bytes);
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as any;
    const header = {
      numRequiredSignatures: message.header.numSignerAccounts,
      numReadonlySigned: message.header.numReadonlySignerAccounts,
      numReadonlyUnsigned: message.header.numReadonlyNonSignerAccounts,
    };
    const base = {
      version: message.version as TxVersion,
      header,
      staticKeys: [...message.staticAccounts] as string[],
      recentBlockhash: message.lifetimeToken as string,
    };

    if (message.version === 1) {
      // A v1 message starts at byte 0 and ends with the instruction payloads (signatures follow),
      // so each payload's position can be found from the end.
      const payloadBytes = message.instructionPayloads.reduce(
        (n: number, p: any) => n + p.instructionAccountIndices.length + p.instructionData.length,
        0
      );
      let offset = messageBytes.length - payloadBytes;
      const instructions = message.instructionHeaders.map((h: any, i: number) => {
        const payload = message.instructionPayloads[i];
        const dataOffset = offset + payload.instructionAccountIndices.length;
        offset = dataOffset + payload.instructionData.length;
        return {
          programIdIndex: h.programAccountIndex,
          accountKeyIndexes: [...payload.instructionAccountIndices],
          data: Uint8Array.from(payload.instructionData),
          dataOffset,
        };
      });
      return { ...base, instructions, lookups: [], config: v1Config(message.configMask, message.configValues) };
    }

    return {
      ...base,
      instructions: message.instructions.map((ix: any) => ({
        programIdIndex: ix.programAddressIndex,
        accountKeyIndexes: [...(ix.accountIndices ?? [])],
        data: Uint8Array.from(ix.data ?? []),
      })),
      lookups: (message.addressTableLookups ?? []).map((l: any) => ({
        accountKey: l.lookupTableAddress,
        writableIndexes: [...l.writableIndexes],
        readonlyIndexes: [...l.readonlyIndexes],
      })),
    };
  } catch {
    return undefined;
  }
}

// Same rules for every format: signers first (writable then readonly), then unsigned accounts
// (writable then readonly), then lookup-table accounts (writable then readonly).
export function isWritable(tx: ParsedTransaction, index: number) {
  const { numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned } = tx.header;
  const numStatic = tx.staticKeys.length;
  if (index < numRequiredSignatures) return index < numRequiredSignatures - numReadonlySigned;
  if (index < numStatic) return index < numStatic - numReadonlyUnsigned;
  const lookupWritable = tx.lookups.reduce((n, l) => n + l.writableIndexes.length, 0);
  return index - numStatic < lookupWritable;
}

// Returns a copy of the transaction with one instruction's data bytes replaced (same length).
// Signatures are left stale: simulations run with sigVerify off.
export function patchInstructionData(bytes: Uint8Array, tx: ParsedTransaction, index: number, data: Uint8Array) {
  const ix = tx.instructions[index];
  const offset = ix.dataOffset ?? findDataOffset(bytes, ix.data);
  if (offset === undefined) throw new Error('instruction data not found');
  const copy = Uint8Array.from(bytes);
  copy.set(data, offset);
  return copy;
}

// Legacy and v0 encode lengths as compact-u16 ahead of the data, which makes the data's position
// easiest to find by locating its bytes (unique in practice for anything worth patching).
function findDataOffset(bytes: Uint8Array, data: Uint8Array): number | undefined {
  if (!data.length) return undefined;
  outer: for (let i = bytes.length - data.length; i >= 0; i--) {
    for (let j = 0; j < data.length; j++) if (bytes[i + j] !== data[j]) continue outer;
    return i;
  }
  return undefined;
}

const EXPLORER_INSPECTOR = 'https://explorer.solana.com/tx/inspector';

// Explorer's inspector reads every format (v1 included) from the message bytes plus signatures.
export function explorerInspectorUrl(bytes: Uint8Array): string | undefined {
  try {
    const { messageBytes, signatures } = getTransactionDecoder().decode(bytes);
    const url = new URL(EXPLORER_INSPECTOR);
    const sigs = Object.values(signatures).map((sig) => bs58.encode(sig ?? new Uint8Array(64)));
    url.searchParams.append('signatures', JSON.stringify(sigs));
    url.searchParams.append('message', Buffer.from(messageBytes).toString('base64'));
    return url.toString();
  } catch {
    return undefined;
  }
}

// Which required signatures are present (non-zero) in the serialized transaction.
export function signatureSlots(bytes: Uint8Array): { signer: string; present: boolean; signature?: string }[] {
  try {
    const { signatures } = getTransactionDecoder().decode(bytes);
    return Object.entries(signatures).map(([signer, sig]) => {
      const present = !!sig && sig.some((b) => b !== 0);
      return { signer, present, signature: present ? bs58.encode(sig!) : undefined };
    });
  } catch {
    return [];
  }
}
