import React from 'react';
import { useAccounts } from '../hooks/useAccounts';

const PRESET_ACCOUNT = [
  {
    id: 'coinbase-1',
    name: 'Coinbase 1',
    address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS',
  },
  {
    id: 'binance-1',
    name: 'Binance 1',
    address: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
  },
];

const PresetAccounts = () => {
  const { addAccount } = useAccounts();

  const onClickPreset = async (id: (typeof PRESET_ACCOUNT)[number]['id']) => {
    const value = PRESET_ACCOUNT.find((account) => account.id === id);
    if (!value) return;
    addAccount({ label: value.name, address: value.address });
  };

  return (
    <div>
      <div className="text-lg font-semibold">Add exchanges accounts</div>

      <div className="space-y-2">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PRESET_ACCOUNT.map((item) => (
            <button
              type="button"
              key={item.id}
              className="flex px-2 py-1 text-xs font-semibold border border-white/20 rounded-lg hover:bg-white/10"
              onClick={() => onClickPreset(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PresetAccounts;
