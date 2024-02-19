import type { FC } from 'react';
import React, { useEffect, useState } from 'react';
import { useConnection } from '../context/ConnectionContext';
import PresetAccounts from '../components/PresetAccounts';
import AvailableAccounts from '../components/AvailableAccounts';
import ManuallyAddAccount from '../components/ManuallyAddAccount';

const Separator = () => <div className="my-6 border-t border-t-white/10" />;

export const Home: FC = () => {
  const { rpcUrl, setRPCUrl } = useConnection();
  const [currentRPCUrl, setCurrentRPCUrl] = useState(rpcUrl);
  useEffect(() => {
    setCurrentRPCUrl(rpcUrl);
  }, [rpcUrl]);

  return (
    <>
      <div className="mt-10 p-6 overflow-y-scroll">
        <AvailableAccounts />
        <Separator />

        <PresetAccounts />
        <Separator />

        <ManuallyAddAccount />
        <Separator />

        <div className="grid w-full items-center gap-4">
          <div className="flex flex-col space-y-1.5">
            <p className="text-base font-semibold">Set RPC URL</p>

            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={currentRPCUrl}
              onChange={(e) => setCurrentRPCUrl(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            onClick={() => setRPCUrl(currentRPCUrl)}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
};
