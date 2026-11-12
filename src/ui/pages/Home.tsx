import type { FC, ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import { ICON } from '../../content/Icon';
import { AccountList, AddAccountForm } from '../components/Accounts';
import { PasteTransaction, RequestHistory } from '../components/InspectTools';
import { RpcSetupCard } from '../components/RpcSetup';
import { RPC_PRESETS, useConnection } from '../context/ConnectionContext';
import { useAccounts } from '../hooks/useAccounts';
import { shortAddress } from '../inspect/format';
import { CheckIcon, ChevronLeft, PanelIcon, PopupIcon, SettingsIcon } from '../kit/icons';
import { AddressAvatar, Button, CopyButton, IconButton, Row, Segmented } from '../kit/kit';
import { rpc } from '../rpc';
import { getTheme, setTheme, ThemeChoice } from '../theme';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { JUP_KEY_STORAGE } from '../../sim/jupApi';
import { DisplayMode, getDisplayMode, setDisplayMode, uiPagePath } from '../../utils/displayMode';
import { currentSurface } from '../view';

type View = 'home' | 'add' | 'settings';

const SubpageHeader: FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas px-3 py-3">
    <IconButton label="Back" onClick={onBack}>
      <ChevronLeft size={18} />
    </IconButton>
    <h1 className="text-[15px] font-semibold">{title}</h1>
  </header>
);

const ViewingAs: FC = () => {
  const { accounts, connectedAddress } = useAccounts();
  const current = accounts.find((a) => a.address.toBase58() === connectedAddress) ?? accounts[0];
  if (!current) {
    return (
      <div className="rounded-card bg-tint px-5 py-6 text-center">
        <div className="text-[17px] font-semibold">Pick an address to become</div>
        <p className="mt-1 text-sm text-ink-2">Dapps will see its balances and positions. Sherlock never signs.</p>
      </div>
    );
  }
  const address = current.address.toBase58();
  return (
    <div className="rounded-card bg-raised px-5 py-5 shadow-float">
      <div className="caps">Viewing dapps as</div>
      <div className="mt-3 flex items-center gap-3">
        <AddressAvatar address={address} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-bold">{current.label}</div>
          <div className="mono truncate text-xs text-ink-2">{shortAddress(address, 8)}</div>
        </div>
        <CopyButton text={address} label="Copy address" />
      </div>
      <Button kind="soft" size="sm" className="mt-4 w-full" onClick={() => rpc.callMethod('openWallet', [address])}>
        Positions and activity
      </Button>
    </div>
  );
};

// One click to the other way of opening Sherlock, as in other wallets. Opening the panel has to
// happen inside the click (Chrome allows sidePanel.open only in response to a user action).
const SwitchMode: FC = () => {
  const surface = currentSurface();
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => {
    chrome.windows.getCurrent().then((w) => setWindowId(w.id));
  }, []);
  if (surface === 'page') return null;
  const toPanel = surface === 'popup';
  const label = toPanel ? 'Open in side panel' : 'Switch to popup';
  return (
    <IconButton
      label={label}
      title={label}
      onClick={() => {
        if (toPanel) {
          if (windowId === undefined) return;
          chrome.sidePanel.open({ windowId }).then(
            () => setDisplayMode('panel').then(() => window.close()),
            () => undefined
          );
          return;
        }
        chrome.action
          .setPopup({ popup: uiPagePath() })
          .then(() => setDisplayMode('popup'))
          .then(() => chrome.action.openPopup().catch(() => undefined))
          .finally(() => window.close());
      }}
    >
      {toPanel ? <PanelIcon size={18} /> : <PopupIcon size={18} />}
    </IconButton>
  );
};

const DisplayModeSetting: FC = () => {
  const [mode, setMode] = useState<DisplayMode>();
  useEffect(() => {
    getDisplayMode().then(setMode);
  }, []);
  if (!mode) return null;
  return (
    <div>
      <h2 className="text-lg font-semibold">Open Sherlock in</h2>
      <p className="mb-3 text-xs text-ink-2">
        The side panel stays open next to the dapp and shows its requests. The popup opens under the toolbar icon, and
        requests open their own window. Applies the next time you click the icon.
      </p>
      <Segmented<DisplayMode>
        value={mode}
        onChange={(m) => {
          setMode(m);
          setDisplayMode(m);
        }}
        items={[
          { id: 'panel', label: 'Side panel' },
          { id: 'popup', label: 'Popup' },
        ]}
      />
    </div>
  );
};

const JupiterKey: FC = () => {
  const [key, setKey] = useLocalStorage<string>(JUP_KEY_STORAGE, '');
  const [draft, setDraft] = useState(key);
  return (
    <div>
      <h2 className="text-lg font-semibold">Jupiter API key</h2>
      <p className="mb-3 text-xs text-ink-2">
        Optional. Prices, token info and fresh quotes come from api.jup.ag, which allows 0.5 requests per second without
        a key. Get one at portal.jup.ag.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKey(draft.trim());
        }}
      >
        <input
          className="field mono text-xs"
          placeholder="x-api-key"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" kind="dark" disabled={draft.trim() === key}>
          Save
        </Button>
      </form>
      {key ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-pos">
          <CheckIcon size={13} /> Key saved on this device
        </p>
      ) : null}
    </div>
  );
};

const Settings: FC<{ onBack: () => void }> = ({ onBack }) => {
  const { rpcUrl, setRPCUrl } = useConnection();
  const [custom, setCustom] = useState(RPC_PRESETS.some((p) => p.url === rpcUrl) ? '' : rpcUrl);
  const [cleared, setCleared] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  return (
    <>
      <SubpageHeader title="Settings" onBack={onBack} />
      <div className="space-y-7 px-5 py-5">
        <DisplayModeSetting />

        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="mb-3 text-xs text-ink-2">Auto follows your system's light or dark mode.</p>
          <Segmented<ThemeChoice>
            value={theme}
            onChange={(t) => {
              setTheme(t);
              setThemeState(t);
            }}
            items={[
              { id: 'auto', label: 'Auto' },
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ]}
          />
        </div>

        <div>
          <h2 className="text-lg font-semibold">Simulation RPC</h2>
          <p className="mb-2 text-xs text-ink-2">
            Needs simulateTransaction. Your own endpoint avoids public rate limits.
          </p>
          <div className="-mx-3">
            {RPC_PRESETS.map((preset) => (
              <Row key={preset.url} onClick={() => setRPCUrl(preset.url)} selected={rpcUrl === preset.url}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{preset.label}</div>
                  <div className="mono truncate text-xs text-ink-2">{preset.url}</div>
                </div>
                {rpcUrl === preset.url ? <CheckIcon size={18} /> : null}
              </Row>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) setRPCUrl(custom.trim());
            }}
          >
            <input
              className="field mono text-xs"
              placeholder="https://your-rpc…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <Button type="submit" kind="dark" disabled={!custom.trim() || custom.trim() === rpcUrl}>
              Use
            </Button>
          </form>
          {!RPC_PRESETS.some((p) => p.url === rpcUrl) ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-pos">
              <CheckIcon size={13} /> Using your custom RPC
            </p>
          ) : null}
        </div>

        <JupiterKey />

        <div>
          <h2 className="text-lg font-semibold">History</h2>
          <p className="mb-3 text-xs text-ink-2">Sherlock keeps the last 50 requests on this device.</p>
          <Button
            kind="outline"
            disabled={cleared}
            onClick={async () => {
              await rpc.callMethod('clearHistory');
              setCleared(true);
            }}
          >
            {cleared ? 'History cleared' : 'Clear history'}
          </Button>
        </div>
      </div>
    </>
  );
};

const Block: FC<{ title?: string; children: ReactNode }> = ({ title, children }) => (
  <section>
    {title ? <h2 className="mb-1 text-lg font-semibold">{title}</h2> : null}
    {children}
  </section>
);

export const Home: FC = () => {
  const [view, setView] = useState<View>('home');

  if (view === 'add') {
    return (
      <div className="fade-in">
        <SubpageHeader title="Add an address" onBack={() => setView('home')} />
        <div className="px-5 py-5">
          <AddAccountForm onDone={() => setView('home')} />
        </div>
      </div>
    );
  }
  if (view === 'settings') {
    return (
      <div className="fade-in">
        <Settings onBack={() => setView('home')} />
      </div>
    );
  }

  return (
    <div className="fade-in">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 bg-canvas px-5 pb-2 pt-4">
        <img src={ICON} alt="" className="h-8 w-8 rounded-lg bg-ink object-contain p-1" />
        <span className="text-[17px] font-bold tracking-tight">Sherlock</span>
        <span className="ml-auto" />
        <SwitchMode />
        <IconButton label="Settings" onClick={() => setView('settings')}>
          <SettingsIcon size={18} />
        </IconButton>
      </header>
      <div className="space-y-7 px-5 pb-6 pt-3">
        <RpcSetupCard />
        <ViewingAs />
        <Block title="Addresses">
          <AccountList editable onAdd={() => setView('add')} />
        </Block>
        <PasteTransaction />
        <RequestHistory />
      </div>
    </div>
  );
};
