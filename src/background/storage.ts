import { PublicKey } from '@solana/web3.js';
import { Account } from '../ui/context/AccountsContext';

export type SerializedAccount = {
  label: string;
  address: string;
};

const accountsKey = 'accounts';
export async function getAccounts(): Promise<SerializedAccount[]> {
  const { accounts } = await chrome.storage.local.get(accountsKey);
  if (!accounts) return [];
  return accounts;
}
export async function addAccount(account: SerializedAccount): Promise<void> {
  const accounts = await getAccounts();
  accounts.push(account);
  return chrome.storage.local.set({ [accountsKey]: accounts });
}

export async function removeAccount(account: SerializedAccount): Promise<void> {
  const accounts = await getAccounts();
  accounts.splice(accounts.findIndex((element) => element.address === account.address), 1);
  return chrome.storage.local.set({ [accountsKey]: accounts });
}
