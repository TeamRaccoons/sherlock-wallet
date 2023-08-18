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
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
  Wallet,
  WalletAccount,
} from '@wallet-standard/core';
import bs58 from 'bs58';
import type { RPC } from '../messages';

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

export class SherlockWallet implements Wallet {
  #name = 'Sherlock Wallet';
  // source https://www.svgrepo.com/svg/323223/sherlock-holmes, license https://www.svgrepo.com/page/licensing#CC%20Attribution, encoded to base64
  #icon =
    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHdpZHRoPSI4MDBweCIgaGVpZ2h0PSI4MDBweCIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZmlsbD0iIzAwMDAwMCIgZD0iTTE4NS40MTggMzYuODgycy0yNC42NyA1Ljc0Ny0zNS43NTYgMTUuNTU3Yy0zOC41ODYgMzQuMTQ5LTUxLjI1NiA2Ny42NTItNTMuNzQ2IDEwNS41M2wtNDMuOTcgNDcuMDIzYzk2LjIyMS0xNy45MDYgMjA3LjY3Mi0yMS45MiAzNDAuNTgxLTIwLjkxMi0yMS4wMDItMTQuMTQ0LTQxLjM3LTI1Ljc1My01OS4zMjItMzYuODE0LTE0LjQ3My0zNS40OTYtMzMuNzAxLTc2LjU5Ny02NS45MzQtOTUuMzczLTE0LjE0NS04LjI0LTI5LjE0NC0xNC4wMjQtNDMuOTYyLTE2LjgzLTEwLjczNi0yMC4zMDctMzUuNC0xMS44MTktMzcuODkgMS44MnpNMTA0Ljk3NyAyMTQuOGMyMC4zMjggNDAuNjIgNTYuNjM1IDc5LjU3NSA4OS43NjEgMTAzLjAxMiAxOC4yNTYgMTIuNjMgMzYuNzQyIDIxLjY1MyA1MS4wMzUgMjQuMTQ0IDExLjk0NiAyLjI0MiAyMy40Ni0xLjQxNiAyOC44MjUtMTAuNjcybC4wMDItLjAwNHYtLjAwMmM4LjEwMy0xNC4yOTkgMTQuNzE0LTI4LjcyNCAyMC4zNTktNDMuMTk3IDE1Ljc3NiAxLjczNyAzMy40MDggMi41NDEgMzguMDQtMS4xNzggNy4zMS01Ljg3MS04Ljc1MS01Ni4wODgtMTYuMDU2LTY5LjQ0MyAzLjA1Ny02LjIyIDMuMDU3LTEyLjc5NSAzLjA1Ny0xNy41OC0zOS40MzYtMi4xOTQtMTUwLjYzOCA2LjQyMy0yMTUuMDIzIDE0Ljkyem0zNDIuMTQyIDYuMDdjLTEzLjMzNS4zMDItMjQuODk3IDkuODU3LTMzLjQyOCAyMi42NjgtOS40MTMgMTQuMTM3LTE2LjEzOCAzMy4zNC0xOC43OTggNTUuMDU1LTIuNjYgMjEuNzE0LS43NzEgNDEuOTcxIDQuOTUgNTcuOTYzIDQuMjkgMTEuOTkgMTEuMTMzIDIyLjMxOCAyMC42NTUgMjcuNTE1bC0xMC43NyAxMDguNjc2IDE3LjkxMyAxLjc3NSAxMC42MTUtMTA3LjEzYzEyLjAxNS0xLjU5MiAyMi40NDMtMTAuNjIgMzAuMjk5LTIyLjQxOCA5LjQxMy0xNC4xMzcgMTYuMTM2LTMzLjMzOSAxOC43OTctNTUuMDUzIDIuNjYtMjEuNzE0Ljc3LTQxLjk3NC00Ljk1Mi01Ny45NjUtNS43MjEtMTUuOTkxLTE1Ljk4My0yOS4wMjYtMzEuMDg3LTMwLjg3N2EyOS4wMzYgMjkuMDM2IDAgMCAwLTQuMTk0LS4yMDl6bTIuMDA0IDE4LjA3NmM1LjQ5NC42NzMgMTEuODQ2IDYuNTQxIDE2LjMzIDE5LjA3NSA0LjQ4NSAxMi41MzMgNi4zOTcgMzAuNDIxIDQuMDMzIDQ5LjcxLTIuMzYzIDE5LjI5LTguNTM4IDM2LjE4Ni0xNS45MTYgNDcuMjY2LTcuMzc3IDExLjA4LTE0Ljk1NSAxNS4yNDItMjAuNDQ5IDE0LjU2OC01LjQ5NC0uNjczLTExLjg0NC02LjU0LTE2LjMyOC0xOS4wNzQtNC40ODUtMTIuNTMzLTYuMzk2LTMwLjQyLTQuMDMzLTQ5LjcwOSAyLjM2My0xOS4yODkgOC41MzYtMzYuMTg3IDE1LjkxNC00Ny4yNjcgNS4wMTEtNi4xNjQgMTIuNjktMTUuMTY4IDIwLjQ0OS0xNC41Njl6TTk5LjE3MiAyNDIuNTNjLTYuMjQzIDguNTQzLTEzLjk3NSAxNy4yNy0yMy4xMTEgMjUuNzQ0LTEyLjExIDExLjIzMS0yNi42NjQgMjEuODI3LTQzLjE5OCAzMC4yMTEgMzcuMTAxIDcuNTI0IDc3LjUxNCAyMy4zODUgMTE1LjIxIDQyLjU5NCA0Mi4zMjYgMjEuNTcgODAuNzc2IDQ3LjE4IDEwNi43NzUgNzEuMTQ1bDIuMzE0LTI0LjY4NmMtMTEuMzg4LTEyLjYzNC0yMy41MjYtMjMuODMtMzUuODY5LTM0LjI1Mi0xMi4xNTItNS4wMDEtMjQuNTU3LTEyLjIwMy0zNi43OTctMjAuNjcyLTM2LjM3MS0yNS4xNjQtNzAuODc4LTYwLjkxNi04NS4zMjQtOTAuMDg0em0zNDQuNTgyIDExLjI3NmMuMDM2IDIxLjUwMyAzLjAxNSA0NS41MzQgOS43NzEgNjQuNjMyIDYuNzI5LTE5Ljc0NSA3LjAyLTU1LjI0Ni05Ljc3MS02NC42MzJ6bS0xMzcuNTk4IDU0LjQzYTM1My4wMTQgMzUzLjAxNCAwIDAgMS03Ljc0IDE2LjU3NGM3LjMzIDUuNDIzIDExLjUzNiAxMC41OTIgMTMuOTA0IDE1LjUwNSAzLjExOSA2LjQ3IDMuNDkgMTMuMDc3IDIuMTc2IDIxLjI5NS0yLjI0IDE0LjAwMi0xMC4yMTMgMzEuNDcyLTE0LjMyIDUyLjIzLTkuMDQ5IDEyLjY3LTEuNTY1IDU2LjA0MiAxOC4yNjUgNjAuOTM4IDQ0LjY3NyAxMS4wMyA2OS43MS0zNS43IDU5LjYxNC00Ni43MTYtOS44MTctMTAuNzEzLTM3LjU5OC0xOS43MzYtNTcuOTItMTkuOTUyIDQuMDQ4LTE0LjczMyA5Ljc5LTI4Ljk4NSAxMi4xMzYtNDMuNjU2IDEuNjY2LTEwLjQxMiAxLjMyNS0yMS40NTYtMy43MzYtMzEuOTU1LTQuMjU1LTguODI3LTExLjU3Ni0xNi44NTYtMjIuMzc5LTI0LjI2NHptLTI3Mi44NzUgOC44MUMyOC41MyAzMjQuMzQyIDIzLjM0NCAzMzIuNTMgMTggMzQxLjQ1OVY0OTRoMjU1LjE1MmMtMi45MjEtMTQuMTItNS42MDktMjguNy04Ljc2My00Mi42MjktLjY1LTUuNjc0LTUuMjY5LTkuMDkzLTkuMDU5LTEzLjMxNC0yMS45NTctMjQuNDU5LTY2LjMyOC01NS45Mi0xMTUuNDMyLTgwLjk0Mi0zNS4xNi0xNy45MTctNzIuOTQtMzIuNjI1LTEwNi42MTctNDAuMDd6Ii8+PC9zdmc+' as const;

  #accounts: SolanaWalletAccount[] = [];

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

  get features(): StandardConnectFeature & StandardEventsFeature & SolanaSignTransactionFeature {
    return {
      'standard:connect': {
        version: '1.0.0',
        connect: this.#connect,
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
      Object.freeze(this);
    }

    this.#rpc = rpc;
  }

  #connect: StandardConnectMethod = async ({ silent } = {}) => {
    const accounts = (await this.#rpc.callMethod('connect')) as { network: string; publicKey: Uint8Array }[];

    if (accounts === null) {
      throw new Error('The user rejected the request.');
    }

    this.#accounts = accounts.map((account: { network: string; publicKey: Uint8Array }) => {
      const { network, publicKey } = account;
      switch (network) {
        case 'solana':
          return new SolanaWalletAccount(publicKey);
        default:
          throw new Error(`Unknown network: '${network}'`);
      }
    });

    this.#emit('change', { accounts: this.accounts });

    return {
      accounts: this.accounts,
    };
  };

  #signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
    const outputs: SolanaSignTransactionOutput[] = [];
    for (const { transaction, account, chain } of inputs) {
      if (!account.features.includes('solana:signTransaction')) throw new Error('invalid feature');

      if (chain && !this.chains.includes(chain as SolanaChain)) throw new Error('invalid chain');

      await this.#rpc.callMethod('signTransaction', [{ address: account.address, transaction }]);
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
