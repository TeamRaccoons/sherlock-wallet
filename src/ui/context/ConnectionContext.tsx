import { Connection } from '@solana/web3.js';
import React, { FC, ReactNode, useMemo, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

export const ConnectionContext = React.createContext<{
  connection: Connection | undefined;
  rpcUrl: string;
  setRPCUrl: (url: string) => void;
}>({
  connection: undefined,
  rpcUrl: '',
  setRPCUrl: (url: string) => {},
});

const DEFAULT_RPC = 'https://global.rpc.hellomoon.io/';

export const ConnectionProvider: FC<{ children: NonNullable<ReactNode> }> = ({ children }) => {
  const [rpcUrl, setRPCUrl] = useLocalStorage<string>('Sherlock-RPC', DEFAULT_RPC);
  console.log({rpcUrl})
  const connection = useMemo(() => new Connection(rpcUrl, 'confirmed'), [rpcUrl]);

  return (
    <ConnectionContext.Provider
      value={{
        connection,
        rpcUrl,
        setRPCUrl,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => React.useContext(ConnectionContext);
