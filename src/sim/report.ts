import { Analysis, SOL } from './analyze';
import { WSOL_MINT } from './programs';
import { explorerInspectorUrl } from './tx';

// A plain-text (Markdown) report someone can paste into a support thread: what was asked, what
// happens, why it fails, and a command that reproduces the simulation with nothing installed.

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

function amount(raw: bigint, decimals: number) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : '+'}${(abs / base).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

const symbol = (a: Analysis, mint: string) =>
  mint === SOL ? 'SOL' : mint === WSOL_MINT ? 'wSOL' : (a.tokens[mint]?.symbol ?? mint);

export type ReportContext = {
  origin?: string;
  method?: string;
  transactionBase64: string;
  rpcHost?: string;
};

export function supportReport(a: Analysis, ctx: ReportContext): string {
  const lines: string[] = [];
  const when = a.source === 'landed' ? `landed at slot ${a.landed?.slot}` : `simulated at slot ${a.slot ?? '?'}`;
  lines.push(`### Transaction report${ctx.origin ? ` · ${ctx.origin.replace(/^https?:\/\//, '')}` : ''}`);
  lines.push('');
  lines.push(`- **Request:** ${ctx.method ?? 'transaction'} · viewing as \`${a.user}\``);
  if (a.landed?.signature) lines.push(`- **Signature:** \`${a.landed.signature}\``);
  lines.push(
    `- **Result:** ${a.err ? `FAILS — ${a.error?.text ?? JSON.stringify(a.err)}` : 'succeeds'} (${when}${ctx.rpcHost ? ` via ${ctx.rpcHost}` : ''}, ${new Date(a.simulatedAt).toISOString()})`
  );
  if (a.error?.location)
    lines.push(`- **Where:** ${a.error.location}${a.error.account ? ` · account ${a.error.account}` : ''}`);
  if (a.error?.left !== undefined || a.error?.right !== undefined) {
    lines.push(`- **Compared values:** left \`${a.error?.left}\` · right \`${a.error?.right}\``);
  }
  if (a.rfq) {
    const left = a.rfq.secondsLeft;
    lines.push(
      `- **RFQ quote:** maker \`${a.rfq.maker}\`, expires at ${a.rfq.expireAt} (${left !== undefined ? (left < 0 ? `${-left}s ago` : `in ${left}s`) : '?'})`
    );
  }
  lines.push(
    `- **Transaction:** ${a.version === 'legacy' ? 'legacy' : `v${String(a.version)}`}, ${a.size}/${a.maxSize} bytes, ${a.accountKeys.length} accounts, ${a.instructions.length} instructions, fee payer \`${a.feePayer}\`, signers ${a.signers.map((s) => `\`${s}\``).join(', ')}`
  );
  lines.push(
    `- **Fees & compute:** ${(Number((a.fees.total ?? 0n) + a.fees.jitoTip) / 1e9).toFixed(9)} SOL total (priority ${a.fees.priority} lamports${a.fees.jitoTip ? `, Jito tip ${a.fees.jitoTip}` : ''}), ${a.compute.consumed ?? '?'} / ${a.compute.limit} CU`
  );

  if (a.userChanges.length) {
    lines.push('', '**Balance changes (viewing address)**', '');
    for (const c of a.userChanges) lines.push(`- ${amount(c.delta, c.decimals)} ${symbol(a, c.mint)}`);
  }

  for (const j of a.jupiter) {
    const decimals = (j.exactOut ? j.inputDecimals : j.outputDecimals) ?? 0;
    const side = j.exactOut ? 'in' : 'out';
    const fmt = (v?: bigint) => (v === undefined ? '?' : amount(v, decimals).replace(/^\+/, ''));
    lines.push('', `**Jupiter ${j.instruction}**`, '');
    lines.push(
      `- quoted ${side} ${fmt(j.exactOut ? j.quotedInAmount : j.quotedOutAmount)}, simulated ${j.failed ? 'reverts' : fmt(j.exactOut ? j.inAmount : j.outAmount)}${j.vsQuoteBps !== undefined ? ` (${j.vsQuoteBps.toFixed(1)} bps vs quote)` : ''}`
    );
    lines.push(
      `- slippage ${j.slippageBps} bps, ${j.exactOut ? 'max in' : 'min out'} ${fmt(j.exactOut ? j.maxInAmount : j.minOutAmount)}, platform fee ${j.platformFeeBps} bps`
    );
    if (j.unbounded)
      lines.push(
        `- without the limit the route fills ${j.unbounded.vsQuoteBps.toFixed(1)} bps vs quote (${j.unbounded.vsLimitBps.toFixed(1)} bps vs limit)`
      );
    if (j.route.length) lines.push(`- route: ${j.route.map((r) => `${r.label} ${r.pct}%`).join(', ')}`);
  }
  for (const r of a.routers) {
    lines.push('', `**Route via ${r.label}**`, '');
    for (const h of r.hops) {
      lines.push(
        `- ${h.label}: ${h.inputAmount ?? '?'} ${h.inputMint ? symbol(a, h.inputMint) : ''} → ${h.outputAmount ?? '?'} ${h.outputMint ? symbol(a, h.outputMint) : ''} (base units)`
      );
    }
  }

  const flagged = a.checks.filter((c) => c.level !== 'ok');
  if (flagged.length) {
    lines.push('', '**Flagged checks**', '');
    for (const c of flagged) lines.push(`- [${c.level}] ${c.title}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  const explorer = explorerInspectorUrl(Uint8Array.from(Buffer.from(ctx.transactionBase64, 'base64')));
  if (explorer) lines.push('', `Explorer inspector: ${explorer}`);

  lines.push('', '**Reproduce** (simulates the exact transaction against current mainnet state):', '', '```bash');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [
      ctx.transactionBase64,
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true },
    ],
  });
  lines.push(`curl -s ${PUBLIC_RPC} -H 'content-type: application/json' -d '${body}'`);
  lines.push('```');

  // The failing program's logs, or the tail of the logs.
  const failing = a.instructions.find((ix) => ix.failed);
  const logs = failing?.logs ?? a.logs.slice(-25);
  if (logs.length) {
    lines.push(
      '',
      `**Logs${failing ? ` (instruction #${failing.path})` : ' (last lines)'}**`,
      '',
      '```',
      ...logs,
      '```'
    );
  }
  return lines.join('\n');
}
