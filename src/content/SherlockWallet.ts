import {
  SOLANA_CHAINS,
  SOLANA_MAINNET_CHAIN,
  SolanaChain,
  SolanaSignTransactionFeature,
  SolanaSignTransactionMethod,
  SolanaSignTransactionOutput,
} from '@solana/wallet-standard';
import type {
  StandardConnectFeature,
  StandardConnectMethod,
  StandardDisconnectFeature,
  StandardDisconnectMethod,
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
  Wallet,
  WalletAccount,
} from '@wallet-standard/core';
import bs58 from 'bs58';
import type { RPC } from '../messages';
import { ICON } from './Icon';

export class SolanaWalletAccount implements WalletAccount {
  readonly #publicKey: Uint8Array;

  get address() {
    return bs58.encode(this.publicKey);
  }

  get publicKey() {
    return this.#publicKey.slice();
  }

  get chains() {
    return [SOLANA_MAINNET_CHAIN] as const;
  }

  get features() {
    return ['solana:signTransaction', 'solana:signAndSendTransaction'] as const;
  }

  constructor(publicKey: Uint8Array) {
    if (new.target === SolanaWalletAccount) {
      Object.freeze(this);
    }

    this.#publicKey = publicKey;
  }
}

let instance = 0;

console.log('ver 1.0.0');
export class SherlockWallet implements Wallet {
  #name = 'Sherlock Wallet';
  // source https://www.svgrepo.com/svg/323223/sherlock-holmes, license https://www.svgrepo.com/page/licensing#CC%20Attribution, encoded to base64
  #icon = ICON;
  #accounts: SolanaWalletAccount[] = [];
  instance: number = 0;

  readonly #listeners: {
    [E in StandardEventsNames]?: StandardEventsListeners[E][];
  } = {};

  #rpc: RPC;

  get version() {
    return '1.0.0' as const;
  }

  get name() {
    return this.#name;
  }

  get icon() {
    return this.#icon;
  }

  get chains() {
    return SOLANA_CHAINS;
  }

  get features(): StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignTransactionFeature {
    return {
      'standard:connect': {
        version: '1.0.0',
        connect: this.#connect,
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: this.#disconnect,
      },
      'standard:events': {
        version: '1.0.0',
        on: this.#on,
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: this.#signTransaction,
      },
    };
  }

  get accounts() {
    return this.#accounts;
  }

  constructor(rpc: RPC) {
    if (new.target === SherlockWallet) {
      this.instance = instance;
      instance++;
      Object.freeze(this);
    }

    rpc.exposeMethod('changeAccounts', async (params) => {
      const accounts = params as { publicKey: Uint8Array }[];

      this.#accounts = accounts.map(({ publicKey }) => 
        new SolanaWalletAccount(publicKey)
      );
      this.#emit('change', { accounts: this.accounts });
    });

    this.#rpc = rpc;
  }

  #connect: StandardConnectMethod = async ({ silent } = {}) => {
    console.log('Connecting on instance:', this.instance);
    console.log('c ver 1.0.0');
    const accounts = (await this.#rpc.callMethod('connect')) as { publicKey: Uint8Array }[];

    if (accounts === null) {
      throw new Error('The user rejected the request.');
    }

    this.#accounts = accounts.map(({ publicKey }) => 
      new SolanaWalletAccount(publicKey)
    );

    this.#emit('change', { accounts: this.accounts });

    return {
      accounts: this.accounts,
    };
  };

  #disconnect: StandardDisconnectMethod = async () => {
    this.#accounts = [];
  }

  #signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
    const outputs: SolanaSignTransactionOutput[] = [];
    for (const { transaction, account, chain } of inputs) {
      if (!account.features.includes('solana:signTransaction')) throw new Error('invalid feature');
      if (chain && !this.chains.includes(chain as SolanaChain)) throw new Error('invalid chain');

      await this.#rpc.callMethod('signTransaction', [{ address: account.address, transaction }]);
      throw Error('The user rejected the transaction');
    }

    return outputs;
  };

  #on: StandardEventsOnMethod = (event, listener) => {
    this.#listeners[event]?.push(listener) || (this.#listeners[event] = [listener]);
    return (): void => this.#off(event, listener);
  };

  #emit<E extends StandardEventsNames>(event: E, ...args: Parameters<StandardEventsListeners[E]>): void {
    // eslint-disable-next-line prefer-spread
    this.#listeners[event]?.forEach((listener) => listener.apply(null, args));
  }

  #off<E extends StandardEventsNames>(event: E, listener: StandardEventsListeners[E]): void {
    this.#listeners[event] = this.#listeners[event]?.filter((existingListener) => listener !== existingListener);
  }
}
