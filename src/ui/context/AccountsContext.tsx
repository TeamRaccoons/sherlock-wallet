import type { FC, ReactNode } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { rpc } from '../rpc';
import { PublicKey } from '@solana/web3.js';
import { SerializedAccount } from '../../background/storage';

export type Account = { label: string; address: PublicKey };

export const AccountsContext = React.createContext<{
  accounts: Account[];
  connectedAddress: string | undefined;
  addAccount: (account: SerializedAccount) => void;
  removeAccount: (account: SerializedAccount) => void;
  changeConnectedAccount: (account: Account) => void;
}>({
  accounts: [],
  connectedAddress: undefined,
  addAccount: () => {},
  removeAccount: () => {},
  changeConnectedAccount: () => {},
});

export const AccountsProvider: FC<{ children: NonNullable<ReactNode> }> = ({ children }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connectedAddress, setConnectedAddress] = useState<string>();

  const updateAccounts = useCallback(async () => {
    const serializedAccounts = (await rpc.callMethod('getAccounts')) as SerializedAccount[];
    const accounts = serializedAccounts.map(({ label, address }) => ({
      label,
      address: new PublicKey(address),
    }));
    setAccounts(accounts);
  }, []);

  const addAccount = useCallback(async (account: SerializedAccount) => {
    if (accounts.some((acc) => acc.address.toBase58() === account.address)) {
      return;
    }

    await rpc.callMethod('addAccount', [account]);
    updateAccounts();
  }, [accounts]);

  const removeAccount = useCallback(async (account: SerializedAccount) => {
    await rpc.callMethod('removeAccount', [account]);
    updateAccounts();
  }, []);

  const updateConnectedAddress = useCallback(async () => {
    const connectedAccounts = await rpc.callMethod('connectedAccounts');
    if (connectedAccounts) {
      setConnectedAddress(new PublicKey(connectedAccounts[0]?.publicKey).toBase58());
    }
  }, []);

  const changeConnectedAccount = useCallback(async (account: Account) => {
    if (!account) return;
    rpc.callMethod('changeAccounts', [{ publicKey: account.address.toBytes() }]);
    setConnectedAddress(account.address.toBase58());
  }, []);

  useEffect(() => {
    updateAccounts();
    updateConnectedAddress();
  }, []);

  return (
    <AccountsContext.Provider value={{ accounts, addAccount, removeAccount, connectedAddress, changeConnectedAccount }}>
      {children}
    </AccountsContext.Provider>
  );
};
