import type { FC, ReactNode } from 'react';
import React from 'react';

import { AccountsProvider } from './AccountsContext';
import { ConnectionProvider } from './ConnectionContext';

export const AppContext: FC<{ children: NonNullable<ReactNode> }> = ({ children }) => {
  return (
    <ConnectionProvider>
      <AccountsProvider>{children}</AccountsProvider>
    </ConnectionProvider>
  );
};
