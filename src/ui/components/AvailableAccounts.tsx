import React from 'react';
import { useAccounts } from '../hooks/useAccounts';
import clsx from 'clsx';

const AvailableAccounts: React.FC<{
  disableDelete?: boolean;
}> = ({ disableDelete = false }) => {
  const { accounts, removeAccount, changeConnectedAccount, connectedAddress } = useAccounts();

  return (
    <div className="space-y-2">
      <p className="text-base font-semibold">Accounts:</p>

      {accounts.length > 0 ? (
        accounts.map((account) => (
          <div
            className={clsx(
              'space-y-1 cursor-pointer flex flex-col p-2 rounded-lg border border-white/50 relative leading-none',
              account.address.toBase58() === connectedAddress ? `bg-white/10` : ``
            )}
            onClick={() => changeConnectedAccount(account)}
            key={account.address.toBase58()}
          >
            <div className="text-sm font-semibold">{account.label} </div>

            <p className="text-xs text-muted-foreground">{account.address.toBase58()}</p>

            {!disableDelete ? (
              <button
                type="button"
                className="absolute right-2 top-2 text-red-500"
                onClick={() => {
                  removeAccount({ label: account.label, address: account.address.toBase58() });
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <div className="text-center">
          <p className="text-base font-semibold text-white/60">No accounts</p>
          <p className="text-xs text-white/40">Quickly add account below, or manually add custom account</p>
        </div>
      )}
    </div>
  );
};

export default AvailableAccounts;
