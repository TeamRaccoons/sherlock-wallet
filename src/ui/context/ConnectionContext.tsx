import React, { FC, ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

export const RPC_PRESETS = [
  { label: 'Solana mainnet (public)', url: PUBLIC_RPC },
  { label: 'Surfpool (local fork)', url: 'http://127.0.0.1:8899' },
  { label: 'Solana devnet', url: 'https://api.devnet.solana.com' },
];

const DEFAULT_RPC = RPC_PRESETS[0].url;
// Endpoints earlier versions shipped as defaults that no longer serve requests.
const RETIRED_RPCS = ['https://global.rpc.hellomoon.io/'];

export const ConnectionContext = React.createContext<{
  rpcUrl: string;
  setRPCUrl: (url: string) => void;
}>({
  rpcUrl: '',
  setRPCUrl: (url: string) => {},
});

export const ConnectionProvider: FC<{ children: NonNullable<ReactNode> }> = ({ children }) => {
  const [storedUrl, setRPCUrl] = useLocalStorage<string>('Sherlock-RPC', DEFAULT_RPC);
  const rpcUrl = RETIRED_RPCS.includes(storedUrl) ? DEFAULT_RPC : storedUrl;

  return (
    <ConnectionContext.Provider
      value={{
        rpcUrl,
        setRPCUrl,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => React.useContext(ConnectionContext);
