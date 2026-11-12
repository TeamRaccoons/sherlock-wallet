import clsx from 'clsx';
import React, { FC, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDown, CopyIcon } from './icons';

// ---- Buttons -------------------------------------------------------------------------------

type ButtonKind = 'dark' | 'soft' | 'outline' | 'ghost';

export const Button: FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: 'sm' | 'md' | 'lg' }
> = ({ kind = 'outline', size = 'md', className, ...props }) => (
  <button
    type="button"
    {...props}
    className={clsx(
      'press inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold disabled:pointer-events-none disabled:opacity-40',
      { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-[15px]' }[size],
      {
        dark: 'bg-accent text-accent-ink hover:opacity-90',
        soft: 'bg-tint text-ink hover:bg-selected',
        outline: 'border border-line-strong bg-canvas text-ink hover:bg-hover',
        ghost: 'text-ink hover:bg-hover',
      }[kind],
      className
    )}
  />
);

export const IconButton: FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }> = ({
  label,
  className,
  ...props
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...props}
    className={clsx(
      'press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-hover disabled:opacity-40',
      className
    )}
  />
);

export const CopyButton: FC<{ text: string; label?: string; className?: string }> = ({
  text,
  label = 'Copy',
  className,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <CheckIcon size={14} className="text-pos" /> : <CopyIcon size={14} className="text-ink-2" />}
    </IconButton>
  );
};

// ---- Segmented control with a sliding indicator ---------------------------------------------

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  className,
  itemClassName,
}: {
  items: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  itemClassName?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const container = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (!el) return;
      const next = { left: el.offsetLeft, width: el.offsetWidth };
      setIndicator((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    // Labels and widths change with the window (short labels in the side panel): follow them.
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [value, items.length]);

  return (
    <div ref={container} className={clsx('relative inline-flex rounded-full bg-tint p-1', className)}>
      {indicator ? (
        <span
          className="absolute bottom-1 top-1 rounded-full bg-[var(--segment)] shadow-[0_1px_3px_rgba(0,0,0,0.12),inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-all duration-[var(--dur-2)] ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      ) : null}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          ref={(el) => {
            if (el) refs.current.set(item.id, el);
          }}
          onClick={() => onChange(item.id)}
          className={clsx(
            'relative z-10 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
            item.id === value ? 'text-ink' : 'text-ink-2 hover:text-ink',
            itemClassName
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ---- Disclosure -----------------------------------------------------------------------------

// Closed content stays mounted but inert, so it is neither focusable nor read out.
export const Collapse: FC<{ open: boolean; children: ReactNode }> = ({ open, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = !open;
  }, [open]);
  return (
    <div ref={ref} className="fold" data-open={open}>
      <div>{children}</div>
    </div>
  );
};

// A ruled, collapsible section: title row with an optional summary on the right.
export const Section: FC<{
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}> = ({ title, summary, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="ml-auto truncate text-sm text-ink-2">{summary}</span>
        <ChevronDown
          size={18}
          className={clsx('shrink-0 text-ink-2 transition-transform duration-[var(--dur-2)]', open && 'rotate-180')}
        />
      </button>
      <Collapse open={open}>
        <div className="pb-5">{children}</div>
      </Collapse>
    </section>
  );
};

// ---- Figures --------------------------------------------------------------------------------

export const FigStrip: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <div
    className={clsx('grid auto-cols-fr grid-flow-col divide-x divide-line rounded-card border border-line', className)}
  >
    {children}
  </div>
);

export const FigCell: FC<{ label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }> = ({
  label,
  value,
  sub,
  tone,
}) => (
  <div className="min-w-0 px-4 py-3">
    <div className="truncate text-xs text-ink-2">{label}</div>
    <div className={clsx('mt-0.5 truncate text-[17px] font-semibold', tone && toneText[tone])}>{value}</div>
    {sub ? <div className="truncate text-xs text-ink-3">{sub}</div> : null}
  </div>
);

export const Stat: FC<{ label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }> = ({
  label,
  value,
  sub,
  className,
}) => (
  <div className={clsx('min-w-0', className)}>
    <div className="truncate text-xs text-ink-2">{label}</div>
    <div className="truncate text-sm font-semibold">{value}</div>
    {sub ? <div className="truncate text-xs text-ink-3">{sub}</div> : null}
  </div>
);

// ---- Status ---------------------------------------------------------------------------------

export type Tone = 'pos' | 'neg' | 'warn' | 'info' | 'muted';

export const toneText: Record<Tone, string> = {
  pos: 'text-pos',
  neg: 'text-neg',
  warn: 'text-warn',
  info: 'text-info',
  muted: 'text-ink-2',
};

export const Pill: FC<{ tone?: Tone; children: ReactNode; className?: string }> = ({
  tone = 'muted',
  children,
  className,
}) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
      {
        pos: 'bg-pos-soft text-pos',
        neg: 'bg-neg-soft text-neg',
        warn: 'bg-warn-soft text-warn',
        info: 'bg-info-soft text-info',
        muted: 'bg-tint text-ink-2',
      }[tone],
      className
    )}
  >
    {children}
  </span>
);

export const Dot: FC<{ tone: Tone; pulse?: boolean; className?: string }> = ({ tone, pulse, className }) => (
  <span
    className={clsx(
      'inline-block h-2 w-2 shrink-0 rounded-full',
      { pos: 'bg-pos', neg: 'bg-neg', warn: 'bg-warn', info: 'bg-info', muted: 'bg-ink-3' }[tone],
      pulse && 'pulse-dot',
      className
    )}
  />
);

export const Switch: FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="inline-flex items-center gap-2 text-xs font-medium text-ink-2"
  >
    <span
      className={clsx(
        'relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur-2)]',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span
        className={clsx(
          'absolute left-0 top-0.5 block h-4 w-4 rounded-full bg-canvas shadow transition-transform duration-[var(--dur-2)] ease-[var(--ease-spring)]',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </span>
    {label}
  </button>
);

// ---- Avatars --------------------------------------------------------------------------------

function hashHue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Deterministic two-tone gradient per address, so the same wallet always looks the same.
export const AddressAvatar: FC<{ address: string; size?: number; className?: string }> = ({
  address,
  size = 32,
  className,
}) => {
  const a = hashHue(address);
  const b = (a + 40 + (hashHue(address.slice(8)) % 80)) % 360;
  return (
    <span
      className={clsx('inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${a} 70% 62%), hsl(${b} 70% 48%))`,
      }}
    />
  );
};

export const LetterAvatar: FC<{ text: string; size?: number }> = ({ text, size = 32 }) => (
  <span
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold uppercase text-ink-2"
    style={{ width: size, height: size }}
  >
    {text
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .charAt(0) || '?'}
  </span>
);

// Many token icons live on IPFS behind gateways that died or rate-limit (nftstorage.link now
// redirects to dweb.link, which answers 429), so IPFS images are tried on gateways that serve them.
const IPFS_GATEWAYS = ['https://ipfs.filebase.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'];

function iconSources(src: string): string[] {
  const match =
    src.match(/^https?:\/\/([a-z0-9]{46,})\.ipfs\.[^/]+\/?(.*)$/i) ?? src.match(/\/ipfs\/([a-z0-9]{46,})\/?(.*)$/i);
  if (!match) return [src];
  const path = match[2] ? `/${match[2]}` : '';
  return [...IPFS_GATEWAYS.map((g) => `${g}${match[1]}${path}`), src];
}

export const TokenIcon: FC<{ src?: string; size?: number; className?: string }> = ({ src, size = 28, className }) => {
  const sources = useMemo(() => (src ? iconSources(src) : []), [src]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [src]);
  return attempt < sources.length ? (
    <img
      src={sources[attempt]}
      alt=""
      onError={() => setAttempt((a) => a + 1)}
      className={clsx('shrink-0 rounded-full bg-tint object-cover', className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={clsx('inline-block shrink-0 rounded-full bg-tint', className)}
      style={{ width: size, height: size }}
    />
  );
};

// ---- Rows -----------------------------------------------------------------------------------

export const Row: FC<{
  onClick?: () => void;
  selected?: boolean;
  children: ReactNode;
  className?: string;
}> = ({ onClick, selected, children, className }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left',
        onClick && 'press hover:bg-hover',
        selected && 'bg-selected hover:bg-selected',
        className
      )}
    >
      {children}
    </Tag>
  );
};
