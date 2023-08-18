import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

// SLIP-44.
// See: https://github.com/satoshilabs/slips/blob/master/slip-0044.md#registered-coin-types.
const BIP44_COIN_TYPE_SOL = 501;

export type Mnemonic = string;

function deriveSolanaKeypair(mnemonic: Mnemonic, index = 0) {
  const seed = bip39.mnemonicToSeedSync(mnemonic, '');
  const path = `m/44'/${BIP44_COIN_TYPE_SOL}'/0'/${index}'`;
  const { publicKey, secretKey } = Keypair.fromSeed(derivePath(path, seed.toString('hex')).key);
  return {
    publicKey: new Uint8Array(publicKey.toBytes()),
    privateKey: secretKey,
  };
}
