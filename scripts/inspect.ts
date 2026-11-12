// Usage: npx tsx scripts/inspect.ts <tx.b64 | base64 string> [userAddress] [rpcUrl]
// Runs the same analysis as the extension popup and prints it.
import { readFileSync, existsSync } from 'fs';
import { analyze } from '../src/sim/analyze';

const [input, user, rpc = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com'] = process.argv.slice(2);
if (!input) {
  console.error('usage: inspect.ts <tx.b64|base64> [user] [rpcUrl]');
  process.exit(1);
}
const b64 = existsSync(input) ? readFileSync(input, 'utf8').trim() : input;

const replacer = (_k: string, v: unknown) =>
  typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `<${v.length} bytes>` : v;

analyze({ rpcUrl: rpc, transaction: Buffer.from(b64, 'base64'), user }).then((a) => {
  const { instructions, logs, accountKeys, tokens, labels, ...rest } = a;
  console.log(JSON.stringify(rest, replacer, 2));
  for (const ix of instructions) {
    console.log(
      `#${ix.path} ${labels[ix.programId] ?? ix.programId} ${ix.decoded?.name ?? '?'} cu=${ix.computeUnits ?? '-'}${ix.decoded?.decodeError ? ' DECODE ERROR ' + ix.decoded.decodeError : ''}`
    );
    for (const inner of ix.inner) {
      console.log(
        `   ${'  '.repeat(inner.stackHeight - 2)}${inner.path} ${labels[inner.programId] ?? inner.programId.slice(0, 8)} ${inner.decoded?.name ?? inner.parsed?.type ?? '?'}${inner.event ? ' ' + JSON.stringify(inner.event.data, replacer) : ''}`
      );
    }
  }
});
