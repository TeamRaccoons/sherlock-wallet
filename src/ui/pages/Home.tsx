import type { FC } from 'react';
import React from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { rpc } from '../rpc';
import { useForm } from 'react-hook-form';
import { PublicKey } from '@solana/web3.js';

type AddAccount = { label: string; address: string };

export const Home: FC = () => {
  const accounts = useAccounts();
  const {
    register,
    handleSubmit,
    formState: { isValid, errors },
  } = useForm<AddAccount>();

  const onSubmit = async (data: AddAccount) => {
    console.log(data);
    await rpc.callMethod('addAccount', [data]);
  };
  return (
    <div className="bg-slate-900 text-card-foreground shadow-sm flex flex-col space-y-6 p-6">
      <h1 className="text-2xl font-semibold leading-none tracking-tight text-center">Sherlock wallet</h1>
      <div>
        {accounts.map((account) => (
          <div className="space-y-1" key={account.address.toBase58()}>
            <h4 className="text-sm font-medium leading-none">{account.label}</h4>
            <p className="text-sm text-muted-foreground">
              <code>{account.address.toBase58()}</code>
            </p>
          </div>
        ))}
      </div>
      <div>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <label
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                htmlFor="label"
              >
                Label
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                id="label"
                placeholder="Label"
                {...register('label', { required: true })}
              />
            </div>
            <div>
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Address
              </label>
              <input
                id="address"
                placeholder="Base58 Address"
                {...register('address', { required: true })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={!isValid}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Add
            </button>
          </div>

          {errors?.address && <span>{'Invalid address'}</span>}
        </form>
        <div className="grid w-full items-center gap-4">
          <div className="flex flex-col space-y-1.5 mt-6">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Set RPC URL
            </label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value="https://global.rpc-public.hellomoon.io/"
              disabled
            />
          </div>
          <button
            disabled={true}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
