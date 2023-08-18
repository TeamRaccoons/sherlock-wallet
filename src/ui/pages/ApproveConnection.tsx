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
    <div>
      <h1>Approve Connection</h1>
      <ul>
        {accounts.map((account) => (
          <li key={account.address.toBase58()}>
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
            />
            <label htmlFor={account.address.toBase58()}>{account.label} {condenseAddress(account.address.toBase58())}</label>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" onClick={denyConnection}>
          Deny
        </button>
        <button
          type="button"
          onClick={() => approveConnection([...selectedAccounts.values()])}
          disabled={!hasSelectedAccounts}
        >
          Approve
        </button>
      </div>
    </div>
  );
};
