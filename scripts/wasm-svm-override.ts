// Usage: RPC_URL(_FILE)=... npx tsx scripts/wasm-svm-override.ts
// Override demos for a brand-new (empty) wallet, each simulated (1) by the RPC: fails, (2) in the
// WASM VM as is: fails the same way, (3) in the WASM VM with giveSol/giveTokens: succeeds.
//  - an SPL TransferChecked of 100 USDC from the wallet's (non-existent) USDC account;
//  - a Jupiter 100 USDC -> SOL swap (skipped when Jupiter's public API rate-limits).
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { giveSol, giveTokens, mergeOverrides, type Overrides } from '../src/sim/wasmSvm';
import { compare, rpcSimulate } from './wasm-svm-check';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const WHALE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const enc = getAddressEncoder();

const ata = async (owner: string) =>
  (
    await getProgramDerivedAddress({
      programAddress: ATA as Address,
      seeds: [enc.encode(owner as Address), enc.encode(TOKEN as Address), enc.encode(USDC as Address)],
    })
  )[0] as string;

// Legacy tx: wallet pays and signs a TransferChecked of `amount` USDC base units to the whale.
async function usdcTransfer(wallet: string, amount: bigint) {
  const keys = [wallet, await ata(wallet), await ata(WHALE), USDC, TOKEN];
  const data = new Uint8Array(10);
  data[0] = 12; // TransferChecked
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = 6; // USDC decimals
  const msg = [
    1,
    0,
    2, // header: 1 signer; mint and token program readonly
    keys.length,
    ...keys.flatMap((k) => [...enc.encode(k as Address)]),
    ...new Uint8Array(32),
    1, // one instruction
    4, // token program
    4,
    1,
    3,
    2,
    0, // source, mint, destination, owner
    data.length,
    ...data,
  ];
  return Uint8Array.from([1, ...new Uint8Array(64), ...msg]);
}

async function demo(label: string, wallet: string, bytes: Uint8Array, overrides: Overrides) {
  const node = await rpcSimulate(bytes);
  console.log(`\n##### ${label}\nrpc (no override): err=${JSON.stringify(node.value.err)}`);
  await compare('wasm, no override', bytes, {});
  const res = await compare('wasm, with overrides', bytes, overrides);
  console.log(`wallet SOL: ${res.value.preBalances[0] / 1e9} -> ${res.value.postBalances[0] / 1e9}`);
  for (const b of res.value.postTokenBalances) {
    const pre = res.value.preTokenBalances.find((p: any) => p.accountIndex === b.accountIndex);
    console.log(
      `${b.owner.slice(0, 6)} ${b.mint.slice(0, 6)}: ${pre?.uiTokenAmount.uiAmountString ?? 0} -> ${b.uiTokenAmount.uiAmountString}`
    );
  }
}

(async () => {
  const wallet = getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32))) as string;
  console.log(`empty wallet ${wallet}`);
  await demo(
    'SPL transfer of 100 USDC',
    wallet,
    await usdcTransfer(wallet, 100_000_000n),
    mergeOverrides(giveSol(wallet, 0.01), giveTokens(wallet, USDC, 100))
  );

  const quote = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${SOL}&amount=100000000&slippageBps=100`
    )
  ).json();
  const swap = await (
    await fetch('https://lite-api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet, dynamicComputeUnitLimit: false }),
    })
  )
    .json()
    .catch(() => ({}));
  if (!swap.swapTransaction) return console.log(`\nJupiter swap demo skipped: ${JSON.stringify(swap).slice(0, 120)}`);
  await demo(
    `Jupiter swap 100 USDC -> ${Number(quote.outAmount) / 1e9} SOL`,
    wallet,
    Uint8Array.from(Buffer.from(swap.swapTransaction, 'base64')),
    mergeOverrides(giveSol(wallet, 0.05), giveTokens(wallet, USDC, 100))
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
