import { analyze, Analysis, AssetDelta } from './analyze';
import { rpcCall, RpcError } from './rpc';

export type BundleSimulation = {
  // 'bundle': one Jito simulateBundle call, in sequence. 'vm': in sequence in Sherlock's in-browser
  // VM. 'independent': neither was available, so each transaction ran on its own from the same state.
  mode: 'bundle' | 'vm' | 'independent';
  unsupportedReason?: string;
  slot?: number;
  succeeded: boolean;
  // Index of the transaction that failed, when the RPC says which.
  failedIndex?: number;
  failure?: string;
  // One analysis per transaction that ran, in order, each against the state the previous left.
  results: Analysis[];
  // The viewing address's net change over the whole bundle.
  net: AssetDelta[];
};

export class BundleUnsupported extends Error {}

// Jito's simulateBundle (on Jito-enabled RPCs, e.g. Triton): the transactions run in sequence on
// one bank, unlike separate simulateTransaction calls that each start from the same state.
export async function simulateBundle(
  rpcUrl: string,
  transactions: Uint8Array[],
  user: string | undefined,
  addressBook?: Record<string, string>
): Promise<BundleSimulation> {
  const encoded = transactions.map((t) => Buffer.from(t).toString('base64'));
  let result: any;
  try {
    result = await rpcCall<any>(rpcUrl, 'simulateBundle', [
      { encodedTransactions: encoded },
      {
        skipSigVerify: true,
        replaceRecentBlockhash: true,
        transactionEncoding: 'base64',
        preExecutionAccountsConfigs: encoded.map(() => null),
        postExecutionAccountsConfigs: encoded.map(() => null),
      },
    ]);
  } catch (e) {
    const message = (e as Error).message;
    // Providers answer "no such method" in many ways; a 403 here may also mean the method alone is
    // blocked, so the VM gets a chance (it reports a refused RPC clearly if everything is blocked).
    if (/disabled|not found|invalid method|method not found|-32601|410|403/i.test(message)) {
      throw new BundleUnsupported(message);
    }
    throw e;
  }

  const value = result.value;
  const summary = value.summary;
  const succeeded = summary === 'succeeded';
  const entries: any[] = value.transactionResults ?? [];
  const results: Analysis[] = [];
  for (let i = 0; i < entries.length; i++) {
    results.push(
      await analyze({
        rpcUrl,
        transaction: transactions[i],
        user,
        addressBook,
        execution: { value: entries[i], slot: result.context?.slot, source: 'bundle' },
      })
    );
  }
  const failedIndex = succeeded ? undefined : results.findIndex((r) => r.err);

  const net = new Map<string, AssetDelta>();
  for (const r of results) {
    for (const c of r.userChanges) {
      const prev = net.get(c.mint);
      if (prev) prev.delta += c.delta;
      else net.set(c.mint, { ...c });
    }
  }

  return {
    mode: 'bundle',
    slot: result.context?.slot,
    succeeded,
    failedIndex: failedIndex !== undefined && failedIndex >= 0 ? failedIndex : undefined,
    failure: succeeded
      ? undefined
      : typeof summary === 'object'
        ? JSON.stringify(summary.failed?.error ?? summary)
        : String(summary),
    results,
    net: [...net.values()].filter((c) => c.delta !== 0n),
  };
}

function netChange(results: Analysis[]) {
  const net = new Map<string, AssetDelta>();
  for (const r of results) {
    for (const c of r.userChanges) {
      const prev = net.get(c.mint);
      if (prev) prev.delta += c.delta;
      else net.set(c.mint, { ...c });
    }
  }
  return [...net.values()].filter((c) => c.delta !== 0n);
}

// In sequence in the in-browser VM (works on any RPC). The VM is loaded on demand.
export async function simulateSequenceInVm(
  rpcUrl: string,
  transactions: Uint8Array[],
  user: string | undefined,
  addressBook?: Record<string, string>
): Promise<BundleSimulation> {
  const vm = await import('./wasmSvm');
  const seq = await vm.simulateSequenceInWasm(rpcUrl, transactions);
  const results: Analysis[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const entry = seq.results[i];
    if (!entry) break;
    results.push(
      await analyze({
        rpcUrl,
        transaction: transactions[i],
        user,
        addressBook,
        execution: { value: entry.value, slot: entry.slot, source: 'wasm' },
      })
    );
  }
  return {
    mode: 'vm',
    slot: seq.slot,
    succeeded: seq.failedIndex === undefined,
    failedIndex: seq.failedIndex,
    results,
    net: netChange(results),
  };
}

export type SequenceEngine = 'auto' | 'rpc' | 'vm';

// Several transactions in order: Jito's simulateBundle when the RPC offers it (or when asked), the
// in-browser VM otherwise (or when asked), and as a last resort each transaction on its own.
export async function simulateSequence(
  rpcUrl: string,
  transactions: Uint8Array[],
  user: string | undefined,
  addressBook?: Record<string, string>,
  engine: SequenceEngine = 'auto'
): Promise<BundleSimulation> {
  let unsupportedReason: string | undefined;
  if (engine !== 'vm') {
    try {
      return await simulateBundle(rpcUrl, transactions, user, addressBook);
    } catch (e) {
      if (!(e instanceof BundleUnsupported)) throw e;
      unsupportedReason = e.message;
    }
  }
  if (engine !== 'rpc') {
    try {
      return { ...(await simulateSequenceInVm(rpcUrl, transactions, user, addressBook)), unsupportedReason };
    } catch (e) {
      // The RPC refused to serve the accounts: simulating one by one would fail the same way.
      if (e instanceof RpcError && e.code === 403) throw e;
      // Otherwise the VM could not run it (e.g. an older browser); fall through.
    }
  }
  const results = await Promise.all(
    transactions.map((transaction) => analyze({ rpcUrl, transaction, user, addressBook }))
  );
  const failedIndex = results.findIndex((r) => r.err);
  return {
    mode: 'independent',
    unsupportedReason,
    slot: results[0]?.slot,
    succeeded: failedIndex < 0,
    failedIndex: failedIndex >= 0 ? failedIndex : undefined,
    results,
    net: netChange(results),
  };
}
