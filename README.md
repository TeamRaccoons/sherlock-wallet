# Sherlock Wallet

<p align="center">
  <img width="200" height="200" src="https://github.com/TeamRaccoons/sherlock-wallet/assets/124664978/45189113-cd0e-4195-8c60-cef0a51aced6">
</p>

A development wallet to allow super easy inspection, debugging and bug reporting. Simulate the state you want and view the signTransaction call easily. 

Most dapps check your address and balances before allowing you to do actions. For example, Jupiter won't allow you to trigger a swap if you don't have the required input tokens, making debugging specific situations a pain in the ass sometimes.

With this system, you can pretend to be any given address, have some tokens or even some state in a program to trigger the same flow.


# Installation
### Chrome extension store
https://chromewebstore.google.com/detail/sherlock-wallet/fnkhhpcgjmehogcdgjihbfbbgcfmogmd

### Or, locally
To use the Sherlock Wallet, you need to have Node.js and pnpm installed. Then setup this repo with

`pnpm i`

`pnpm start`

In Chrome/Brave, Go to "More tools" > "Extensions." Enable "Developer mode" by toggling the switch on the top right corner of the page. Click on "Load unpacked" button, select the `dist` folder generated in this repo.

# Features

- Use any Solana wallet on any wallet-standard compatible dApp to start inspecting
- Add to address book
- Transaction dump, inspection and simulation. Linking to the explorer

# Use cases

- Investigate user specific bugs, by reproducing their input using their address
- Reverse engineer dApps
- Test dApp with a wallet holding large token amounts

# Risks

- Too much fun

# Alternatives
https://github.com/everlastingsong/pubkey-sollet A slim inspection wallet through sollet wallet adapter
