import type { Execution } from './analyze';
import { rpcCall } from './rpc';

export type Landed = { transaction: Uint8Array; execution: Execution };

// Fetches a landed transaction and maps its meta onto simulateTransaction's result shape, so the
// same analysis explains what actually happened on chain.
export async function fetchLanded(rpcUrl: string, signature: string): Promise<Landed> {
  const tx = await rpcCall<any>(rpcUrl, 'getTransaction', [
    signature,
    { encoding: 'base64', maxSupportedTransactionVersion: 1, commitment: 'confirmed' },
  ]);
  if (!tx) throw new Error('Transaction not found (not landed yet, too old for this RPC, or a typo)');
  const meta = tx.meta ?? {};
  const value = {
    err: meta.err,
    fee: meta.fee,
    logs: meta.logMessages ?? [],
    preBalances: meta.preBalances,
    postBalances: meta.postBalances,
    preTokenBalances: meta.preTokenBalances,
    postTokenBalances: meta.postTokenBalances,
    innerInstructions: meta.innerInstructions,
    loadedAddresses: meta.loadedAddresses,
    unitsConsumed: meta.computeUnitsConsumed,
    returnData: meta.returnData,
  };
  return {
    transaction: Uint8Array.from(Buffer.from(tx.transaction[0], 'base64')),
    execution: { value, slot: tx.slot, blockTime: tx.blockTime ?? undefined, source: 'landed', signature },
  };
}
