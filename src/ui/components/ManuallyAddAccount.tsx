import React from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { useForm } from 'react-hook-form';
import { PublicKey } from '@solana/web3.js';

export type AddAccount = { label: string; address: string };

const ManuallyAddAccount = () => {
  const { addAccount } = useAccounts();
  const {
    register,
    handleSubmit,
    formState: { isValid, errors },
    reset,
  } = useForm<AddAccount>();

  const onSubmit = async (data: AddAccount) => {
    addAccount(data);
    reset();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="text-lg font-semibold">Manually add accounts</div>

      <div className="grid w-full items-center gap-4">
        <div className="flex flex-col space-y-1.5">
          <label
            className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            htmlFor="label"
          >
            Label
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background file:border-0 file:bg-transparent file:text-xs file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            id="label"
            placeholder="Label"
            autoComplete="off"
            {...register('label', { required: true })}
          />
        </div>

        <div>
          <label className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Address
          </label>
          <input
            id="address"
            placeholder="Base58 Address"
            autoComplete="off"
            {...register('address', {
              required: true,
              validate: (value: string) => {
                try {
                  new PublicKey(value);
                  return true;
                } catch (e) {
                  return false;
                }
              },
            })}
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
  );
};

export default ManuallyAddAccount;
