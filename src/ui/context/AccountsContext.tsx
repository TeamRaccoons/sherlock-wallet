import type { FC, ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import { rpc } from '../rpc';
import { PublicKey } from '@solana/web3.js';
import { SerializedAccount } from '../../background/storage';

export type Account = { label: string; address: PublicKey };

export const AccountsContext = React.createContext<Account[]>([]);

export const AccountsProvider: FC<{ children: NonNullable<ReactNode> }> = ({ children }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    const updateAccounts = async () => {
      const serializedAccounts = (await rpc.callMethod('getAccounts')) as SerializedAccount[];
      const accounts = serializedAccounts.map(({ label, address }) => ({
        label,
        address: new PublicKey(address),
      }));
      setAccounts(accounts);
    };
    updateAccounts();
  }, []);

  return <AccountsContext.Provider value={accounts}>{children}</AccountsContext.Provider>;
};
