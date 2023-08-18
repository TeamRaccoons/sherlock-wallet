import type { FC } from 'react';
import React, { useState } from 'react';
import { condenseAddress } from '../../utils/address';
import { useAccounts } from '../hooks/useAccounts';
import { rpc } from '../rpc';
import { Account } from '../context/AccountsContext';

let approveConnection: (accounts: Account[]) => void;
let denyConnection: () => void;
rpc.exposeMethod('connect', async () => {
  return new Promise((resolve) => {
    approveConnection = (accounts: Account[]) => {
      resolve(accounts.map(({ address }) => ({ network: 'solana', publicKey: address.toBytes() })));
    };
    denyConnection = () => {
      resolve(null);
    };
  });
});

export const ApproveConnection: FC = () => {
  const accounts = useAccounts();

  const [selectedAccounts, setSelectedAccounts] = useState(new Map<string, Account>());
  const hasSelectedAccounts = selectedAccounts.size > 0;

  const isAccountSelected = (address: string) => selectedAccounts.has(address);

  const handleAccountSelected = (address: string, selected: boolean) => {
    if (selected) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const account = accounts.find((account) => account.address.toBase58() === address)!;
      setSelectedAccounts((prevSelectedAccounts) => {
        prevSelectedAccounts.set(address, account);
        return new Map(prevSelectedAccounts.entries());
      });
    } else {
      setSelectedAccounts((prevSelectedAccounts) => {
        prevSelectedAccounts.delete(address);
        return new Map(prevSelectedAccounts.entries());
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-card-foreground shadow-sm flex flex-col space-y-6 p-6">
      <h1 className="text-2xl font-semibold leading-none tracking-tight text-center">Approve Connection</h1>
      <div className="flex justify-center">
        <ul>
          {accounts.map((account) => (
            <li key={account.address.toBase58()} className="space-x-2 flex items-center">
              <input
                type="checkbox"
                id={account.address.toBase58()}
                checked={isAccountSelected(account.address.toBase58())}
                onChange={(event) => {
                  const address = event.target.value;
                  const selected = event.target.checked;
                  handleAccountSelected(address, selected);
                }}
                value={account.address.toBase58()}
                className="h-4 w-4 rounded border-gray-300 text-slate-600 focus:ring-slate-600"
              />
              <label
                htmlFor={account.address.toBase58()}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {account.label} {condenseAddress(account.address.toBase58())}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="sticky bottom-0 !mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={denyConnection}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => approveConnection([...selectedAccounts.values()])}
          disabled={!hasSelectedAccounts}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Approve
        </button>
      </div>
    </div>
  );
};
