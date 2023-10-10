import type { FC } from 'react';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Header from './components/Header';
import { AppContext } from './context';
import { ApproveConnection } from './pages/ApproveConnection';
import { Home } from './pages/Home';
import { InspectTransaction } from './pages/InspectTransaction';

const Root: FC = () => {
  const queryParams = new URLSearchParams(window.location.search);
  const page = queryParams.get('page');

  const Route = page
    ? {
        approveConnection: ApproveConnection,
        inspectTransaction: InspectTransaction,
      }[page]!
    : Home;

  return (
    <StrictMode>
      <AppContext>
        <div className="w-[420px] bg-slate-900 text-card-foreground shadow-sm flex flex-col">
          <Header />
          <Route />
        </div>
      </AppContext>
    </StrictMode>
  );
};

const rootNode = document.getElementById('root');
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const root = createRoot(rootNode!);
root.render(<Root />);
