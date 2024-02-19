import React, { useEffect } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { useForm, useWatch } from 'react-hook-form';
import { PublicKey } from '@solana/web3.js';
import { Account } from '../context/AccountsContext';

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

const InstantAddAccount: React.FC<{ approveConnection: (accounts: Account[]) => void }> = ({ approveConnection }) => {
  const { addAccount } = useAccounts();
  const {
    control,
    register,
    handleSubmit,
    formState: { isValid, errors },
    reset,
  } = useForm<{ address: string }>();

  const onSubmit = async (data: { address: string }) => {
    const account: Account = { label: shortenAddress(data.address), address: new PublicKey(data.address) };
    addAccount({ label: account.label, address: account.address.toBase58() });
    approveConnection([account]);
    reset();
  };

  const address = useWatch({ control, name: 'address' });
  useEffect(() => {
    setTimeout(() => {
      if (address && !errors.address) {
        onSubmit({ address });
      }
    }, 0);
  }, [address, errors]);

  console.log(isValid, errors);
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="text-lg font-semibold">Quick Add</div>

      <div className="grid w-full items-center gap-4">
        <div>
          <label className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Address
          </label>
          <input
            id="address"
            placeholder="Base58 Address"
            autoComplete="off"
            autoFocus
            {...register('address', {
              required: true,
              validate: (value: string) => {
                try {
                  new PublicKey(value);
                  return true;
                } catch (e) {
                  return 'Invalid pubkey';
                }
              },
            })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      {address && !isValid && <span className='block pt-2 text-red-400'>{'Invalid address'}</span>}
    </form>
  );
};

export default InstantAddAccount;
