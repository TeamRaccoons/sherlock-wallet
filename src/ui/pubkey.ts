import { address, getAddressEncoder, isAddress } from '@solana/kit';

// The little the UI needs from a public key, on top of @solana/kit (no web3.js in the bundle).
export class Pubkey {
  constructor(private readonly value: string) {
    if (!isAddress(value)) throw new Error(`Invalid address ${value}`);
  }
  toBase58() {
    return this.value;
  }
  toBytes() {
    return Uint8Array.from(getAddressEncoder().encode(address(this.value)));
  }
}

export { isAddress };
