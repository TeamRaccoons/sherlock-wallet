import clsx from 'clsx';
import type { FC, ReactNode } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { getTokenInfos, TokenInfo } from '../../sim/jupApi';
import {
  Activity,
  getActivity,
  getLendPositions,
  getPerpPositions,
  getPerpTrades,
  getPredictHistory,
  getPredictPositions,
  getRecurringOrders,
  getSolBalance,
  getTriggerOrders,
  LendPosition,
  PerpPosition,
  PerpTrade,
  PredictEvent,
  PredictPosition,
  RecurringOrder,
  TriggerOrder,
} from '../../sim/wallet';
import { useConnection } from '../context/ConnectionContext';
import { useAccounts } from '../hooks/useAccounts';
import { explorerAddress, formatUsd, shortAddress, symbolOf, timeAgo, toneOf } from '../inspect/format';
import { ChevronLeft, ChevronRight, ExternalIcon, RefreshIcon, XIcon } from '../kit/icons';
import {
  AddressAvatar,
  Button,
  CopyButton,
  FigCell,
  IconButton,
  Pill,
  Row,
  Segmented,
  TokenIcon,
  Tone,
} from '../kit/kit';
import { rpc } from '../rpc';
import { closeView, isPanel } from '../view';

// Everything an address holds and did on Jupiter, one window: open positions and orders first,
// then activity. Each source loads on its own, so a failing API only empties its own block.

type Load<T> = { data?: T; error?: string; loading: boolean };

function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fetcher().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: (e as Error).message, loading: false })
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

const usd = (v?: number, signed = false) => (v === undefined ? '—' : formatUsd(v, { signed }));
const price = (v?: number) =>
  v === undefined ? '—' : `$${v.toLocaleString('en-US', { maximumSignificantDigits: v < 1 ? 3 : 6 })}`;
const amount = (v?: number) => (v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 4 }));
const when = (ms?: number) => (ms ? timeAgo(ms) : '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const Card: FC<{ title: ReactNode; right?: ReactNode; children: ReactNode }> = ({ title, right, children }) => (
  <section className="rounded-card border border-line bg-raised px-5 py-4 max-[560px]:px-4">
    <div className="mb-2 flex min-h-[28px] items-center gap-3">
      <h2 className="truncate text-[15px] font-semibold">{title}</h2>
      {right ? <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
    {children}
  </section>
);

const Block: FC<{ title: string; load: Load<unknown[]>; onRetry: () => void; children: ReactNode }> = ({
  title,
  load,
  onRetry,
  children,
}) => {
  if (load.loading && !load.data) return null;
  if (load.error) {
    return (
      <div className="flex items-center gap-2 border-t border-line py-2.5 text-xs">
        <span className="font-semibold">{title}</span>
        <span className="text-neg">{load.error}</span>
        <button type="button" onClick={onRetry} className="ml-auto font-semibold text-ink-2 hover:text-ink">
          Retry
        </button>
      </div>
    );
  }
  if (!load.data?.length) return null;
  return (
    <div className="border-t border-line pb-2 pt-3">
      <div className="caps mb-1.5">
        {title} · {load.data.length}
      </div>
      {children}
    </div>
  );
};

// A row of figures with a heading cell; `onClick` replays its transaction in the inspector.
// Below this width (the side panel) a row puts its heading on one line and its figures under it.
const NARROW = 600;

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

// `grow` widens cells by index (flex-grow), for a column whose text should not be cut.
const Line: FC<{
  head: ReactNode;
  sub?: ReactNode;
  cells: ReactNode[];
  grow?: number[];
  onClick?: () => void;
}> = ({ head, sub, cells, grow, onClick }) => {
  const narrow = useNarrow();
  const chevron = onClick ? (
    <ChevronRight size={14} className="shrink-0 text-ink-3" />
  ) : (
    <span className="w-3.5 shrink-0" />
  );
  const heading = (
    <div className={clsx('min-w-0', narrow ? 'flex-1' : 'flex-[1.6]')}>
      <div className="truncate text-[13px] font-semibold">{head}</div>
      {sub ? <div className="truncate text-xs text-ink-2">{sub}</div> : null}
    </div>
  );
  if (narrow) {
    return (
      <Row onClick={onClick} className="-mx-3 flex-col !items-stretch !gap-1 !py-2">
        <div className="flex items-center gap-2">
          {heading}
          {chevron}
        </div>
        {/* Figures keep their natural width and wrap rather than being cut. */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-1 text-[13px]">
          {cells.map((c, i) => (
            <div key={i} className="whitespace-nowrap">
              {c}
            </div>
          ))}
        </div>
      </Row>
    );
  }
  return (
    <Row onClick={onClick} className="-mx-3 !py-2">
      {heading}
      {cells.map((c, i) => (
        <div key={i} className="min-w-0 flex-1 truncate text-right text-[13px]" style={{ flexGrow: grow?.[i] ?? 1 }}>
          {c}
        </div>
      ))}
      {chevron}
    </Row>
  );
};

const Signed: FC<{ v?: number; pct?: number }> = ({ v, pct }) => (
  <span className={toneOf(v)}>
    {usd(v, true)}
    {pct !== undefined ? (
      <span className="ml-1 text-xs">
        ({pct > 0 ? '+' : ''}
        {pct.toFixed(1)}%)
      </span>
    ) : null}
  </span>
);

// ---- Positions ----------------------------------------------------------------------------------

const PerpRows: FC<{ items: PerpPosition[] }> = ({ items }) => (
  <>
    {items.map((p) => (
      <Line
        key={p.pubkey}
        head={
          <>
            {p.market}{' '}
            <span className={p.side === 'long' ? 'text-pos' : 'text-neg'}>
              {p.side} {p.leverage ? `${p.leverage.toFixed(1)}×` : ''}
            </span>
          </>
        }
        sub={`opened ${when(p.openedAt)} · entry ${price(p.entryPrice)}`}
        cells={[
          <>
            {usd(p.sizeUsd)}
            <div className="text-xs text-ink-2">collateral {usd(p.collateralUsd)}</div>
          </>,
          <>
            {price(p.markPrice)}
            <div className="text-xs text-ink-2">liq. {price(p.liquidationPrice)}</div>
          </>,
          <>
            <Signed v={p.pnlUsd} pct={p.pnlPct} />
            <div className="text-xs text-ink-2">fees {usd(p.feesUsd)}</div>
          </>,
        ]}
      />
    ))}
  </>
);

const PredictRows: FC<{ items: PredictPosition[] }> = ({ items }) => (
  <>
    {items.map((p) => (
      <Line
        key={p.pubkey}
        head={
          <>
            <span className={p.yes ? 'text-pos' : 'text-neg'}>{p.yes ? 'Yes' : 'No'}</span> · {p.market ?? '?'}
          </>
        }
        sub={p.event}
        cells={[
          <>
            {amount(p.contracts)}
            <div className="text-xs text-ink-2">avg {price(p.avgPrice)}</div>
          </>,
          <>
            {usd(p.valueUsd)}
            <div className="text-xs text-ink-2">mark {price(p.markPrice)}</div>
          </>,
          p.claimable ? (
            <Pill tone="pos">Claimable</Pill>
          ) : (
            <>
              <Signed v={p.pnlUsd} pct={p.pnlPct} />
              <div className="text-xs text-ink-2">cost {usd(p.costUsd)}</div>
            </>
          ),
        ]}
      />
    ))}
  </>
);

const LendRows: FC<{ items: LendPosition[] }> = ({ items }) => (
  <>
    {items.map((p) => (
      <Line
        key={p.mint}
        head={
          <span className="flex items-center gap-2">
            <TokenIcon src={p.icon} size={18} />
            {p.symbol}
          </span>
        }
        cells={[
          `${amount(p.amount)} ${p.symbol}`,
          usd(p.usd),
          p.apyPct === undefined ? '—' : <span className="text-pos">{p.apyPct.toFixed(2)}% APY</span>,
        ]}
      />
    ))}
  </>
);

const TriggerRows: FC<{ items: TriggerOrder[]; tokens: Record<string, TokenInfo>; replay: (s: string) => void }> = ({
  items,
  tokens,
  replay,
}) => (
  <>
    {items.map((o) => {
      const inSym = symbolOf(o.inputMint, tokens);
      const outSym = symbolOf(o.outputMint, tokens);
      const limitPrice = o.making && o.taking ? o.taking / o.making : undefined;
      return (
        <Line
          key={o.key}
          head={`${inSym} → ${outSym}`}
          sub={`created ${when(o.createdAt)}${o.expiresAt ? ` · expires ${new Date(o.expiresAt).toLocaleString()}` : ''}`}
          cells={[
            `${amount(o.making)} ${inSym}`,
            `${amount(o.taking)} ${outSym}`,
            <span className="text-ink-2">
              {limitPrice === undefined
                ? '—'
                : `${limitPrice.toLocaleString('en-US', { maximumSignificantDigits: 4, maximumFractionDigits: 12 })} ${outSym}/${inSym}`}
            </span>,
          ]}
          onClick={o.openTx ? () => replay(o.openTx!) : undefined}
        />
      );
    })}
  </>
);

const cadence = (s?: number) =>
  !s ? '' : s % 86400 === 0 ? `every ${s / 86400}d` : s % 3600 === 0 ? `every ${s / 3600}h` : `every ${s / 60}m`;

const RecurringRows: FC<{
  items: RecurringOrder[];
  tokens: Record<string, TokenInfo>;
  replay: (s: string) => void;
}> = ({ items, tokens, replay }) => (
  <>
    {items.map((o) => {
      const inSym = symbolOf(o.inputMint, tokens);
      const outSym = symbolOf(o.outputMint, tokens);
      return (
        <Line
          key={o.key}
          head={`${inSym} → ${outSym}`}
          sub={`${o.perCycle !== undefined ? `${amount(o.perCycle)} ${inSym} ` : ''}${cadence(o.everySeconds)}`}
          cells={[
            `${amount(o.used)} / ${amount(o.deposited)} ${inSym}`,
            `${amount(o.received)} ${outSym}`,
            <span className="text-ink-2">{when(o.createdAt)}</span>,
          ]}
          onClick={o.openTx ? () => replay(o.openTx!) : undefined}
        />
      );
    })}
  </>
);

// ---- Activity -----------------------------------------------------------------------------------

const KIND: Record<string, { label: string; tone: Tone }> = {
  order_created: { label: 'Order placed', tone: 'muted' },
  order_filled: { label: 'Filled', tone: 'pos' },
  order_failed: { label: 'Failed', tone: 'neg' },
  order_closed: { label: 'Closed', tone: 'muted' },
  payout_claimed: { label: 'Payout', tone: 'pos' },
  position_lost: { label: 'Lost', tone: 'neg' },
};

const PredictActivity: FC<{ address: string; replay: (s: string) => void }> = ({ address, replay }) => {
  const [events, setEvents] = useState<PredictEvent[]>([]);
  const [next, setNext] = useState<number | undefined>(0);
  const [total, setTotal] = useState<number>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const more = useCallback(
    async (start: number, reset = false) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await getPredictHistory(address, start);
        setEvents((prev) => (reset ? page.events : [...prev, ...page.events]));
        setNext(page.next);
        setTotal(page.total);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [address]
  );
  useEffect(() => {
    more(0, true);
  }, [more]);

  return (
    <ActivityList
      empty="No Predict activity."
      error={error}
      loading={loading}
      onMore={next !== undefined && events.length ? () => more(next) : undefined}
      footer={total !== undefined ? `${events.length} of ${total} events` : undefined}
    >
      {events.map((e) => {
        const kind = KIND[e.kind] ?? { label: e.kind, tone: 'muted' as Tone };
        const side = (
          <>
            {e.buy ? 'Buy' : 'Sell'} <span className={e.yes ? 'text-pos' : 'text-neg'}>{e.yes ? 'Yes' : 'No'}</span> ·{' '}
            {e.market ?? '?'}
          </>
        );
        const detail =
          e.kind === 'order_filled'
            ? `${amount(e.filled)} @ ${price(e.avgPrice)} · ${usd(e.buy ? e.costUsd : e.proceedsUsd)}`
            : e.kind === 'payout_claimed'
              ? usd(e.payoutUsd)
              : e.contracts
                ? `${amount(e.contracts)} contracts${e.maxPrice ? ` · limit ${price(e.maxPrice)}` : ''}`
                : '';
        return (
          <Line
            key={e.id}
            head={side}
            sub={e.event}
            cells={[
              <span className="font-semibold" title={detail}>
                {detail || '—'}
              </span>,
              <Pill tone={kind.tone}>{kind.label}</Pill>,
              <span className="text-ink-2">{when(e.time)}</span>,
            ]}
            grow={[2.2, 0.8, 0.7]}
            onClick={e.signature ? () => replay(e.signature!) : undefined}
          />
        );
      })}
    </ActivityList>
  );
};

const PerpActivity: FC<{ load: Load<PerpTrade[]>; replay: (s: string) => void }> = ({ load, replay }) => (
  <ActivityList empty="No Perps trades." error={load.error} loading={load.loading}>
    {(load.data ?? []).map((t, i) => (
      <Line
        key={t.signature ?? i}
        head={
          <>
            {t.market} <span className={t.side === 'long' ? 'text-pos' : 'text-neg'}>{t.side}</span>
          </>
        }
        sub={[t.action, t.orderType].filter(Boolean).join(' · ')}
        cells={[
          <>
            {t.sizeUsd ? usd(t.sizeUsd) : `collateral ${usd(t.collateralUsd, true)}`}
            <div className="text-xs text-ink-2">@ {price(t.price)}</div>
          </>,
          t.pnlUsd !== undefined ? <Signed v={t.pnlUsd} /> : <span className="text-ink-3">—</span>,
          <span className="text-ink-2">{when(t.time)}</span>,
        ]}
        onClick={t.signature ? () => replay(t.signature!) : undefined}
      />
    ))}
  </ActivityList>
);

const TxActivity: FC<{ address: string; rpcUrl: string; replay: (s: string) => void }> = ({
  address,
  rpcUrl,
  replay,
}) => {
  const [items, setItems] = useState<Activity[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const more = useCallback(
    async (before?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await getActivity(rpcUrl, address, before);
        setItems((prev) => (before ? [...prev, ...page] : page));
        setDone(page.length < 25);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [address, rpcUrl]
  );
  useEffect(() => {
    more();
  }, [more]);
  const failed = items.filter((t) => t.failed).length;

  return (
    <ActivityList
      empty="No transactions."
      error={error}
      loading={loading}
      onMore={!done && items.length ? () => more(items[items.length - 1].signature) : undefined}
      footer={items.length ? `${items.length} transactions · ${failed} failed` : undefined}
    >
      {items.map((t) => (
        <Line
          key={t.signature}
          head={<span className="mono">{shortAddress(t.signature, 10)}</span>}
          sub={`slot ${t.slot.toLocaleString('en-US')}`}
          cells={[
            t.failed ? <Pill tone="neg">Failed</Pill> : <Pill tone="pos">Success</Pill>,
            <span />,
            <span className="text-ink-2">{t.time ? new Date(t.time).toLocaleString() : ''}</span>,
          ]}
          onClick={() => replay(t.signature)}
        />
      ))}
    </ActivityList>
  );
};

const ActivityList: FC<{
  empty: string;
  error?: string;
  loading: boolean;
  onMore?: () => void;
  footer?: string;
  children: ReactNode[];
}> = ({ empty, error, loading, onMore, footer, children }) => (
  <div>
    {children.length ? children : !loading && !error ? <p className="py-3 text-sm text-ink-2">{empty}</p> : null}
    {error ? <p className="py-2 text-xs text-neg">{error}</p> : null}
    {loading ? <p className="py-2 text-xs text-ink-3">Loading…</p> : null}
    {footer || onMore ? (
      <div className="mt-2 flex items-center gap-3">
        {footer ? <span className="text-xs text-ink-3">{footer}</span> : null}
        {onMore ? (
          <Button kind="outline" size="sm" className="ml-auto" onClick={onMore} disabled={loading}>
            Load more
          </Button>
        ) : null}
      </div>
    ) : null}
  </div>
);

// ---- Page ---------------------------------------------------------------------------------------

type Tab = 'tx' | 'predict' | 'perps';

export const Wallet: FC = () => {
  const address = new URLSearchParams(window.location.search).get('address') ?? '';
  const { accounts } = useAccounts();
  const { rpcUrl } = useConnection();
  const label = accounts.find((a) => a.address.toBase58() === address)?.label;
  const [tab, setTab] = useState<Tab>('tx');
  const [refresh, setRefresh] = useState(0);

  const sol = useLoad(() => getSolBalance(rpcUrl, address), [rpcUrl, address, refresh]);
  const perps = useLoad(() => getPerpPositions(address), [address, refresh]);
  const predict = useLoad(() => getPredictPositions(address), [address, refresh]);
  const lend = useLoad(() => getLendPositions(address), [address, refresh]);
  const triggers = useLoad(() => getTriggerOrders(address), [address, refresh]);
  const recurring = useLoad(() => getRecurringOrders(address), [address, refresh]);
  const perpTrades = useLoad(() => getPerpTrades(address), [address, refresh]);

  const replay = (signature: string) => rpc.callMethod('inspectSignature', [{ address, signature }]);

  const sum = (xs: (number | undefined)[] | undefined) =>
    xs?.length ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : undefined;
  const perpPnl = sum(perps.data?.map((p) => p.pnlUsd));
  const sources = [perps, predict, lend, triggers, recurring];
  const loading = sources.some((s) => s.loading);
  const nothingOpen = !loading && sources.every((s) => !s.error && !s.data?.length);

  const [tokens, setTokens] = useState<Record<string, TokenInfo>>({});
  useEffect(() => {
    const mints = [...(triggers.data ?? []), ...(recurring.data ?? [])].flatMap((o) => [o.inputMint, o.outputMint]);
    // Asked once the queued Jupiter calls are done, so it does not compete with them for the rate limit.
    if (mints.length && !loading) getTokenInfos(mints).then((m) => setTokens(Object.fromEntries(m)));
  }, [triggers.data, recurring.data, loading]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas px-3 py-2">
        <IconButton label={isPanel() ? 'Back' : 'Close'} onClick={closeView}>
          {isPanel() ? <ChevronLeft size={18} /> : <XIcon size={18} />}
        </IconButton>
        <AddressAvatar address={address} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">{label ?? 'Wallet'}</div>
          <div className="mono truncate text-[11px] text-ink-2">{address}</div>
        </div>
        <CopyButton text={address} label="Copy address" />
        <a href={explorerAddress(address)} target="_blank" rel="noreferrer" title="Open in Explorer">
          <IconButton label="Open in Explorer">
            <ExternalIcon size={16} />
          </IconButton>
        </a>
        <IconButton label="Refresh" onClick={() => setRefresh((r) => r + 1)}>
          <RefreshIcon size={16} className={clsx(loading && 'animate-spin')} />
        </IconButton>
      </header>

      <main className="flex-1 space-y-4 px-5 pb-6 pt-4 max-[560px]:px-3">
        {/* Five figures in a row in a window, two per row in the narrow side panel. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line min-[600px]:grid-cols-5 [&>*:last-child]:col-span-2 min-[600px]:[&>*:last-child]:col-span-1 [&>*]:bg-canvas">
          <FigCell label="SOL" value={sol.data === undefined ? '—' : amount(sol.data)} sub={sol.error} />
          <FigCell
            label="Perps PnL"
            value={perpPnl === undefined ? '—' : usd(perpPnl, true)}
            tone={perpPnl === undefined ? undefined : perpPnl > 0 ? 'pos' : perpPnl < 0 ? 'neg' : undefined}
            sub={`${perps.data?.length ?? 0} open`}
          />
          <FigCell
            label="Predict value"
            value={usd(sum(predict.data?.map((p) => p.valueUsd)))}
            sub={plural(predict.data?.length ?? 0, 'position')}
          />
          <FigCell label="Lend deposits" value={usd(sum(lend.data?.map((p) => p.usd)))} />
          <FigCell
            label="Open orders"
            value={String((triggers.data?.length ?? 0) + (recurring.data?.length ?? 0))}
            sub="limit + DCA"
          />
        </div>

        <Card title="Open on Jupiter" right={loading ? <span className="text-xs text-ink-3">Loading…</span> : null}>
          {nothingOpen ? <p className="py-2 text-sm text-ink-2">No open positions or orders.</p> : null}
          <Block title="Perps" load={perps} onRetry={perps.reload}>
            <PerpRows items={perps.data ?? []} />
          </Block>
          <Block title="Predict" load={predict} onRetry={predict.reload}>
            <PredictRows items={predict.data ?? []} />
          </Block>
          <Block title="Lend · Earn" load={lend} onRetry={lend.reload}>
            <LendRows items={lend.data ?? []} />
          </Block>
          <Block title="Limit orders" load={triggers} onRetry={triggers.reload}>
            <TriggerRows items={triggers.data ?? []} tokens={tokens} replay={replay} />
          </Block>
          <Block title="DCA" load={recurring} onRetry={recurring.reload}>
            <RecurringRows items={recurring.data ?? []} tokens={tokens} replay={replay} />
          </Block>
        </Card>

        <Card
          title="Activity"
          right={
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              items={[
                { id: 'tx', label: 'Transactions' },
                { id: 'predict', label: 'Predict' },
                { id: 'perps', label: 'Perps' },
              ]}
            />
          }
        >
          <p className="mb-1 text-xs text-ink-3">Click a row to replay its transaction in the inspector.</p>
          {tab === 'tx' ? <TxActivity key={refresh} address={address} rpcUrl={rpcUrl} replay={replay} /> : null}
          {tab === 'predict' ? <PredictActivity key={refresh} address={address} replay={replay} /> : null}
          {tab === 'perps' ? <PerpActivity load={perpTrades} replay={replay} /> : null}
        </Card>
      </main>
    </div>
  );
};
