import React from 'react';
import { ICON } from '../../content/Icon';
import { useAccounts } from '../hooks/useAccounts';

const Header = () => {
  const { connectedAddress } = useAccounts();

  return (
    <div className="fixed z-50 bg-slate-900 flex w-full justify-between p-4 border-b border-b-white/10">
      <div className="flex w-full space-x-4 items-center">
        <img src={ICON} width={24} height={24} className="object-fit" />
        <h1 className="text-lg font-semibold leading-none tracking-tight text-center ">Sherlock</h1>
      </div>

      <div className="flex items-center">
        {connectedAddress ? <div className="w-2 h-2 bg-green-700 rounded-full overflow-hidden" /> : null}
      </div>
    </div>
  );
};

export default Header;
