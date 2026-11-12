# Sherlock Wallet

<p align="center">
  <img width="200" height="200" src="https://github.com/TeamRaccoons/sherlock-wallet/assets/124664978/45189113-cd0e-4195-8c60-cef0a51aced6">
</p>

A development wallet to allow super easy inspection, debugging and bug reporting. Simulate the state you want and view the signTransaction call easily. 

Most dapps check your address and balances before allowing you to do actions. For example, Jupiter won't allow you to trigger a swap if you don't have the required input tokens, making debugging specific situations a pain in the ass sometimes.

With this system, you can pretend to be any given address, have some tokens or even some state in a program to trigger the same flow.


# Installation

The Chrome Web Store has an older version without the inspector. Get this one prebuilt, or build it yourself.

### Prebuilt

1. Download [`sherlock-wallet-0.1.2.zip`](https://github.com/solwhitey/sherlock-wallet/releases/download/v0.1.2/sherlock-wallet-0.1.2.zip) from the [v0.1.2 release](https://github.com/solwhitey/sherlock-wallet/releases/tag/v0.1.2) and unzip it.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and select the unzipped **`sherlock-wallet-0.1.2`** folder.

### From source

You need [Node.js](https://nodejs.org) 20 or later and [Git](https://git-scm.com). Nothing else: `npx` fetches the right pnpm, and the Solana VM (`src/sim/svm.wasm`) is committed already built, so Rust is not needed.

1. Get the code:

   ```bash
   git clone https://github.com/TeamRaccoons/sherlock-wallet.git
   cd sherlock-wallet
   ```

   Until [#11](https://github.com/TeamRaccoons/sherlock-wallet/pull/11) is merged, the inspector lives on a fork's branch: clone it with `git clone -b simulation-inspector https://github.com/solwhitey/sherlock-wallet.git` instead.

2. Install the dependencies, exactly as locked:

   ```bash
   npx pnpm@10 install --frozen-lockfile
   ```

3. Build:

   ```bash
   npx pnpm@10 build
   ```

   It takes a few seconds and ends with `✨ Built`. Each build starts from an empty `build` folder.

4. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and select the **`build`** folder inside `sherlock-wallet`.

### Updating

```bash
git pull
npx pnpm@10 install --frozen-lockfile
npx pnpm@10 build
```

Then click the reload icon on Sherlock's card in `chrome://extensions`. Run the install step every time: a pull can change the dependencies.

### Troubleshooting

- ***"Could not load file 'content/index.ts' for content script"*** means the repo or `src` was selected instead of `build`. Remove that card in `chrome://extensions` and load `build`.
- ***"Manifest file is missing or unreadable"*** means the build had not finished or failed. Run `npx pnpm@10 build` again and wait for `✨ Built`, then load `build`.
- **`ERR_PNPM_LOCKFILE_BREAKING_CHANGE`** means an old pnpm (8 or earlier). Use `npx pnpm@10` as above rather than a global `pnpm`, and don't add `--force`: it would throw away the lockfile. A warning about the Node version means Node is older than 20 (`node -v`).
- **Don't use `npm install` or `yarn`**: they ignore `pnpm-lock.yaml` and install newer versions than the ones tested.
- **The extension still behaves like the old version** after rebuilding: click its reload icon in `chrome://extensions`, then close and reopen the side panel or popup.
- **Simulations fail with HTTP 403:** the public Solana RPC refuses requests from browsers. Set your own RPC (Helius, Triton, QuickNode… all have free tiers) in the card Sherlock shows on first open, or in Settings.

For development, `npx pnpm@10 start` rebuilds into `dist` on every change; load `dist` instead and reload the extension after each change. To rebuild the Solana VM itself, see `docs/wasm-svm.md`.

# Features

- Legacy, v0 and v1 (SIMD-0385) transactions, decoded with @solana/kit; v1 header limits and flat priority fees are read and checked
- Opens in Chrome's side panel or as a popup, your choice (the header button switches in one click; also in Settings). In the side panel, connection and signing requests show inside it, next to the dapp, with Back returning to where you were; when Chrome does not allow opening the panel (no click behind the request), or in popup mode, a request window opens instead
- Wallet view for any address: open Jupiter positions (Perps, Predict, Lend, limit orders, DCA) and activity (transactions, Predict fills and failures, Perps trades); every row replays its transaction in the inspector
- Use any Solana address on any wallet-standard dApp: `signTransaction`, `signAndSendTransaction`, `signAndSendAllTransactions` and `signMessage` all open the inspector (and are always rejected — Sherlock holds no keys)
- Simulation in the popup, re-run every 5 seconds against the current chain state (stale blockhashes are replaced):
  - balance changes for the impersonated address, in tokens and USD, and for every other owner touched (pools, vaults)
  - fees (base, priority, Jito tips), rent locked and reclaimed, compute used against the limit, loaded account data
  - checks: transaction size (1232 bytes for legacy/v0, 4096 for v1), compute headroom, priority fee against recent fees on the same accounts, expired blockhash, extra signers
  - errors decoded by name from the failing program's IDL (e.g. `SlippageToleranceExceeded`)
- Jupiter swaps (v6 `route`/`shared_accounts_route`/`exact_out` and the `_v2` variants used by Ultra):
  - quoted vs simulated amount in bps, minimum out / maximum in, and the room left before the slippage limit (what a sandwich could take)
  - value in vs out at Jupiter prices, platform fee and positive-slippage cap
  - route plan and the hops actually simulated, per AMM
  - when the swap reverts on slippage, it is simulated again with the limit opened to show how far past it the route fills
  - a fresh quote for the same trade to compare against, and a chart of the simulated output over time
- Instructions decoded from Anchor IDLs fetched on-chain (any program that publishes one), or bundled for programs that publish none (Jupiter Lend: Vaults, Earn, Liquidity, Flashloan, DEX, Oracle), with inner instructions, events, per-instruction compute and account names
- Logs, accounts, raw base64, Explorer inspector link and a JSON report export
- Request history: reopen and re-simulate any past request; paste any serialized transaction (base64 or base58) to inspect it as one of your addresses
- Fork mode: the transaction runs in a Solana VM inside the extension (LiteSVM compiled to WebAssembly, loaded only when used), against live mainnet accounts plus balances you set ("give this wallet 1,000 USDC"). No backend or local process; needs Chrome 133+. Build notes in `docs/wasm-svm.md`
- RPC presets, including a local [Surfpool](https://surfpool.run) fork

The simulation engine (`src/sim`) has no browser dependencies. Run it from the command line with:

`RPC_URL=https://... pnpm inspect <tx.b64 | base64> [address]`

# Use cases

- Investigate user specific bugs, by reproducing their input using their address
- Reverse engineer dApps
- Test dApp with a wallet holding large token amounts

# Risks

- Too much fun

# Alternatives
https://github.com/everlastingsong/pubkey-sollet A slim inspection wallet through sollet wallet adapter
