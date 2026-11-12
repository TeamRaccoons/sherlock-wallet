import { Pubkey } from '../pubkey';
import type { FC } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { AccountRow, isAddress } from '../components/Accounts';
import { Account } from '../context/AccountsContext';
import { useAccounts } from '../hooks/useAccounts';
import { shortAddress } from '../inspect/format';
import { Button, LetterAvatar } from '../kit/kit';
import { rpc } from '../rpc';

let approveConnection: (accounts: Account[]) => void;
let denyConnection: () => void;
rpc.exposeMethod('connect', async () => {
  return new Promise((resolve) => {
    approveConnection = (accounts: Account[]) => {
      resolve(accounts.map(({ address }) => ({ publicKey: address.toBytes() })));
    };
    denyConnection = () => {
      resolve(null);
    };
  });
});

export const ApproveConnection: FC = () => {
  const { accounts, addAccount, changeConnectedAccount, connectedAddress } = useAccounts();
  const origin = new URLSearchParams(window.location.search).get('origin')?.replace(/^https?:\/\//, '');
  const [pasted, setPasted] = useState('');

  // Default to the first address the first time accounts load.
  useEffect(() => {
    if (!connectedAddress && accounts[0]) changeConnectedAccount(accounts[0]);
  }, [accounts, connectedAddress, changeConnectedAccount]);

  const selected = useMemo(
    () => accounts.find((account) => account.address.toBase58() === connectedAddress),
    [accounts, connectedAddress]
  );

  // Pasting a new address connects straight away as that address.
  useEffect(() => {
    const value = pasted.trim();
    if (!isAddress(value)) return;
    const account: Account = { label: shortAddress(value), address: new Pubkey(value) };
    addAccount({ label: account.label, address: value });
    approveConnection([account]);
  }, [pasted, addAccount]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 px-6 pt-8">
        <div className="flex items-center gap-3">
          <LetterAvatar text={origin ?? '?'} size={40} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{origin ?? 'A dapp'}</div>
            <div className="text-xs text-ink-2">wants to connect</div>
          </div>
        </div>
        <h1 className="mt-6 text-[26px] font-bold leading-tight tracking-tight">Who do you want to be?</h1>
        <p className="mt-1 text-sm text-ink-2">Tap an address to connect as it. Sherlock never signs anything.</p>

        <div className="-mx-3 mt-5">
          {accounts.map((account) => (
            <AccountRow
              key={account.address.toBase58()}
              account={account}
              selected={account.address.toBase58() === connectedAddress}
              onSelect={() => {
                // One tap: become this address and connect.
                changeConnectedAccount(account);
                approveConnection?.([account]);
              }}
            />
          ))}
        </div>

        <input
          className="field mono mt-4"
          placeholder="Or paste any address"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          autoFocus={!accounts.length}
        />
        {pasted && !isAddress(pasted) ? (
          <p className="mt-2 text-xs text-neg">That is not a valid Solana address.</p>
        ) : null}
      </div>

      <div className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-line bg-canvas px-6 py-4">
        <Button kind="outline" size="lg" onClick={() => denyConnection?.()}>
          Cancel
        </Button>
        <Button kind="dark" size="lg" disabled={!selected} onClick={() => selected && approveConnection([selected])}>
          Connect
        </Button>
      </div>
    </div>
  );
};
