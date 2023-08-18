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
    <div>
      <h1>Sherlock wallet</h1>
      <ul>
        {accounts.map((account) => (
          <li key={account.address.toBase58()}>
            <p>{account.label}</p>
            <code>{account.address.toBase58()}</code>
          </li>
        ))}
      </ul>
      <div style={{ padding: '1em' }}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <label>Label</label>
          <input id="label" placeholder="label" {...register('label', { required: true })} />

          <label>Address</label>
          <input id="address" placeholder="base58 address" {...register('address', { required: true })} />
          {errors?.address && <span>{'Invalid address'}</span>}
          <button type="submit" disabled={!isValid}>
            Add
          </button>
        </form>
        <div>
          Set RPC URL
          <input value="https://global.rpc-public.hellomoon.io/" disabled />
          <button disabled={true}>Save</button>
        </div>
      </div>
    </div>
  );
};
