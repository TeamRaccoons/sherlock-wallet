// Usage: RPC_URL(_FILE)=... npx tsx scripts/wasm-svm-precompiles.ts
// Builds transactions with ed25519, secp256k1 and secp256r1 signature-verify instructions (one
// valid, one with a tampered message each) and compares the WASM VM with the RPC.
// ed25519 and P-256 sign with Node's crypto; secp256k1 (recoverable, keccak) with @noble, which
// is only a transitive dependency, so it is loaded from pnpm's store (test-only).
import { generateKeyPairSync, sign } from 'crypto';
import { createRequire } from 'module';
import { getAddressEncoder, type Address } from '@solana/kit';
import { compare } from './wasm-svm-check';

const require = createRequire(import.meta.url);
const store = new URL('../node_modules/.pnpm/', import.meta.url).pathname;
const { secp256k1 } = require(`${store}@noble+curves@1.9.7/node_modules/@noble/curves/secp256k1.js`);
const { keccak_256 } = require(`${store}@noble+hashes@1.8.0/node_modules/@noble/hashes/sha3.js`);

const FEE_PAYER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'; // funded; sigVerify is off
const ED25519 = 'Ed25519SigVerify111111111111111111111111111';
const SECP256K1 = 'KeccakSecp256k11111111111111111111111111111';
const SECP256R1 = 'Secp256r1SigVerify1111111111111111111111111';
const enc = getAddressEncoder();

const shortVec = (n: number) => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const u16 = (n: number) => [n & 0xff, n >> 8];

// Legacy transaction: fee payer + one precompile instruction with no accounts.
function legacyTx(program: string, data: Uint8Array) {
  const msg = [
    1,
    0,
    1, // header: 1 signer, 0 readonly signed, 1 readonly unsigned
    ...shortVec(2),
    ...enc.encode(FEE_PAYER as Address),
    ...enc.encode(program as Address),
    ...new Uint8Array(32), // blockhash (replaced / unchecked)
    ...shortVec(1),
    1, // program id index
    ...shortVec(0),
    ...shortVec(data.length),
    ...data,
  ];
  return Uint8Array.from([...shortVec(1), ...new Uint8Array(64), ...msg]);
}

const message = new TextEncoder().encode('sherlock precompile check');
const tampered = (m: Uint8Array) => Uint8Array.from(m, (b, i) => (i === 0 ? b ^ 1 : b));

function ed25519Data(msg: Uint8Array) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const sig = sign(null, message, privateKey);
  const SELF = 0xffff;
  // num, pad, offsets {sig, sigIx, pub, pubIx, msg, msgLen, msgIx}, pubkey, signature, message
  return Uint8Array.from([
    1,
    0,
    ...u16(48),
    ...u16(SELF),
    ...u16(16),
    ...u16(SELF),
    ...u16(112),
    ...u16(msg.length),
    ...u16(SELF),
    ...pub,
    ...sig,
    ...msg,
  ]);
}

function secp256r1Data(msg: Uint8Array) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  const pub = [y[31] & 1 ? 3 : 2, ...x];
  const sig = Uint8Array.from(sign('sha256', message, { key: privateKey, dsaEncoding: 'ieee-p1363' }));
  // The precompile wants low S: s' = n - s when s > n/2.
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  let s = BigInt('0x' + Buffer.from(sig.subarray(32)).toString('hex'));
  if (s > n / 2n) s = n - s;
  sig.set(Buffer.from(s.toString(16).padStart(64, '0'), 'hex'), 32);
  const SELF = 0xffff;
  return Uint8Array.from([
    1,
    0,
    ...u16(49),
    ...u16(SELF),
    ...u16(16),
    ...u16(SELF),
    ...u16(113),
    ...u16(msg.length),
    ...u16(SELF),
    ...pub,
    ...sig,
    ...msg,
  ]);
}

function secp256k1Data(msg: Uint8Array) {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false).subarray(1);
  const eth = keccak_256(pub).subarray(12);
  const sig = secp256k1.sign(keccak_256(message), priv);
  // num, offsets {sig u16, sigIx u8, eth u16, ethIx u8, msg u16, msgLen u16, msgIx u8}, eth, sig+recid, message
  return Uint8Array.from([
    1,
    ...u16(32),
    0,
    ...u16(12),
    0,
    ...u16(97),
    ...u16(msg.length),
    0,
    ...eth,
    ...sig.toCompactRawBytes(),
    sig.recovery,
    ...msg,
  ]);
}

(async () => {
  for (const [name, program, build] of [
    ['ed25519', ED25519, ed25519Data],
    ['secp256k1', SECP256K1, secp256k1Data],
    ['secp256r1', SECP256R1, secp256r1Data],
  ] as const) {
    await compare(`${name} valid`, legacyTx(program, build(message)));
    await compare(`${name} tampered message`, legacyTx(program, build(tampered(message))));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
