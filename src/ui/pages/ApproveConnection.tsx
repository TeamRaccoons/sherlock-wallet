import type { FC } from 'react';
import React, { useEffect, useMemo } from 'react';
import AvailableAccounts from '../components/AvailableAccounts';
import { Account } from '../context/AccountsContext';
import { useAccounts } from '../hooks/useAccounts';
import { rpc } from '../rpc';
import InstantAddAccount from '../components/InstantAddAccount';

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
  const { accounts, changeConnectedAccount, connectedAddress } = useAccounts();

  // Pick first as default
  useEffect(() => {
    changeConnectedAccount(accounts[0]);
  }, [accounts, changeConnectedAccount]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.address.toBase58() === connectedAddress),
    [accounts, connectedAddress]
  );

  return (
    <div className="w-[420px] overflow-x-hidden min-h-screen bg-slate-900 text-card-foreground shadow-sm flex flex-col space-y-6 p-6">
      <h1 className="text-2xl font-semibold leading-none tracking-tight text-center">Approve Connection</h1>
      <InstantAddAccount approveConnection={approveConnection} />
      <AvailableAccounts disableDelete />

      <div className="sticky bottom-0 !mt-auto pt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={denyConnection}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => {
            selectedAccount && approveConnection([selectedAccount]);
          }}
          disabled={!connectedAddress}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Approve
        </button>
      </div>
    </div>
  );
};
