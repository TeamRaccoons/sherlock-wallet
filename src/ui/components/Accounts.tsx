import { isAddress as isValidAddress } from '../pubkey';
import React, { FC, useState } from 'react';
import type { Account } from '../context/AccountsContext';
import { useAccounts } from '../hooks/useAccounts';
import { shortAddress } from '../inspect/format';
import { CheckIcon, PlusIcon, TrashIcon } from '../kit/icons';
import { AddressAvatar, Button, IconButton, Row } from '../kit/kit';

export const KNOWN_WALLETS = [
  { label: 'Coinbase 1', address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS' },
  { label: 'Coinbase 2', address: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm' },
  { label: 'Binance 1', address: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S' },
];

export function isAddress(value: string) {
  return isValidAddress(value.trim());
}

export const AccountRow: FC<{ account: Account; selected?: boolean; onSelect?: () => void; onRemove?: () => void }> = ({
  account,
  selected,
  onSelect,
  onRemove,
}) => {
  const address = account.address.toBase58();
  return (
    <Row onClick={onSelect} selected={selected}>
      <AddressAvatar address={address} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{account.label}</div>
        <div className="mono truncate text-xs text-ink-2">{shortAddress(address, 6)}</div>
      </div>
      {onRemove ? (
        <IconButton
          label={`Remove ${account.label}`}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <TrashIcon size={14} className="text-ink-2" />
        </IconButton>
      ) : null}
      {selected ? <CheckIcon size={18} className="shrink-0" /> : null}
    </Row>
  );
};

export const AccountList: FC<{ editable?: boolean; onAdd?: () => void }> = ({ editable, onAdd }) => {
  const { accounts, connectedAddress, changeConnectedAccount, removeAccount } = useAccounts();
  return (
    <div className="-mx-3">
      {accounts.map((account) => (
        <AccountRow
          key={account.address.toBase58()}
          account={account}
          selected={account.address.toBase58() === connectedAddress}
          onSelect={() => changeConnectedAccount(account)}
          onRemove={
            editable ? () => removeAccount({ label: account.label, address: account.address.toBase58() }) : undefined
          }
        />
      ))}
      {onAdd ? (
        <Row onClick={onAdd}>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-line-strong">
            <PlusIcon size={16} />
          </span>
          <span className="text-[15px] font-semibold">Add an address</span>
        </Row>
      ) : null}
    </div>
  );
};

export const AddAccountForm: FC<{ onDone: () => void }> = ({ onDone }) => {
  const { accounts, addAccount } = useAccounts();
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const valid = isAddress(address);
  const known = new Set(accounts.map((a) => a.address.toBase58()));

  return (
    <div className="space-y-6">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          addAccount({ label: label.trim() || shortAddress(address.trim()), address: address.trim() });
          onDone();
        }}
      >
        <input
          className="field mono"
          placeholder="Solana address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoFocus
        />
        <input
          className="field"
          placeholder="Name (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        {address && !valid ? <p className="text-xs text-neg">That is not a valid Solana address.</p> : null}
        <Button type="submit" kind="dark" size="lg" className="w-full" disabled={!valid}>
          Add address
        </Button>
      </form>

      <div>
        <div className="caps mb-1">Or pick a known wallet</div>
        <div className="-mx-3">
          {KNOWN_WALLETS.filter((w) => !known.has(w.address)).map((w) => (
            <Row
              key={w.address}
              onClick={() => {
                addAccount(w);
                onDone();
              }}
            >
              <AddressAvatar address={w.address} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{w.label}</div>
                <div className="mono truncate text-xs text-ink-2">{shortAddress(w.address, 6)}</div>
              </div>
              <PlusIcon size={16} className="text-ink-2" />
            </Row>
          ))}
        </div>
      </div>
    </div>
  );
};
