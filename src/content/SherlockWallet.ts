import { SOLANA_CHAINS, type SolanaChain } from '@solana/wallet-standard-chains';
import type {
  SolanaSignAndSendAllTransactionsFeature,
  SolanaSignAndSendAllTransactionsMethod,
  SolanaSignAndSendTransactionFeature,
  SolanaSignAndSendTransactionInput,
  SolanaSignAndSendTransactionMethod,
  SolanaSignMessageFeature,
  SolanaSignMessageMethod,
  SolanaSignTransactionFeature,
  SolanaSignTransactionInput,
  SolanaSignTransactionMethod,
} from '@solana/wallet-standard-features';
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
import { base58Encode } from '../messages/bytes';
import type { RPC } from '../messages';
import { ICON } from './Icon';

export class SolanaWalletAccount implements WalletAccount {
  readonly #publicKey: Uint8Array;

  get address() {
    return base58Encode(this.publicKey);
  }

  get publicKey() {
    return this.#publicKey.slice();
  }

  get chains() {
    return SOLANA_CHAINS;
  }

  get features() {
    return FEATURES;
  }

  constructor(publicKey: Uint8Array) {
    if (new.target === SolanaWalletAccount) {
      Object.freeze(this);
    }

    this.#publicKey = publicKey;
  }
}

const FEATURES = [
  'solana:signTransaction',
  'solana:signAndSendTransaction',
  'solana:signAndSendAllTransactions',
  'solana:signMessage',
] as const;

const REJECTED = 'The user rejected the request.';

// Identifies one dapp request across service worker restarts (see the content script).
const requestKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

let instance = 0;

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

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignTransactionFeature &
    SolanaSignAndSendTransactionFeature &
    SolanaSignAndSendAllTransactionsFeature &
    SolanaSignMessageFeature {
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
        supportedTransactionVersions: ['legacy', 0, 1],
        signTransaction: this.#signTransaction,
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0, 1],
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      'solana:signAndSendAllTransactions': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0, 1],
        signAndSendAllTransactions: this.#signAndSendAllTransactions,
      },
      'solana:signMessage': {
        version: '1.1.0',
        signMessage: this.#signMessage,
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

      this.#accounts = accounts.map(({ publicKey }) => new SolanaWalletAccount(publicKey));
      this.#emit('change', { accounts: this.accounts });
    });

    this.#rpc = rpc;
  }

  // `silent` is how dapps reconnect on page load: Sherlock answers it from the sites already
  // approved, without opening a window, and returns no accounts otherwise.
  #connect: StandardConnectMethod = async ({ silent } = {}) => {
    const accounts = (await this.#rpc.callMethod('connect', [{ key: requestKey(), silent: !!silent }])) as
      { publicKey: Uint8Array }[] | null;

    if (accounts === null) {
      if (silent) return { accounts: [] };
      throw new Error(REJECTED);
    }

    this.#accounts = accounts.map(({ publicKey }) => new SolanaWalletAccount(publicKey));

    this.#emit('change', { accounts: this.accounts });

    return {
      accounts: this.accounts,
    };
  };

  #disconnect: StandardDisconnectMethod = async () => {
    this.#accounts = [];
    this.#emit('change', { accounts: this.accounts });
    await this.#rpc.callMethod('disconnect');
  };

  // Sherlock holds no keys: every request opens the inspector and is rejected once it closes.
  async #inspectTransactions(
    method: 'signTransaction' | 'signAndSendTransaction',
    inputs: readonly (SolanaSignTransactionInput | SolanaSignAndSendTransactionInput)[]
  ): Promise<never> {
    if (!inputs.length) throw new Error('no transactions');
    for (const { chain } of inputs) {
      if (chain && !this.chains.includes(chain as SolanaChain)) throw new Error('invalid chain');
    }
    await this.#rpc.callMethod('inspectTransactions', [
      {
        method,
        address: inputs[0].account.address,
        chain: inputs[0].chain,
        key: requestKey(),
        transactions: inputs.map((i) => i.transaction),
      },
    ]);
    throw new Error(REJECTED);
  }

  #signTransaction: SolanaSignTransactionMethod = async (...inputs) =>
    this.#inspectTransactions('signTransaction', inputs);

  #signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (...inputs) =>
    this.#inspectTransactions('signAndSendTransaction', inputs);

  #signAndSendAllTransactions: SolanaSignAndSendAllTransactionsMethod = async (inputs) =>
    this.#inspectTransactions('signAndSendTransaction', inputs);

  #signMessage: SolanaSignMessageMethod = async (...inputs) => {
    const [{ account, message }] = inputs;
    await this.#rpc.callMethod('inspectMessage', [{ address: account.address, message, key: requestKey() }]);
    throw new Error(REJECTED);
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
