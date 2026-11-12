// IDLs shipped with Sherlock for programs that don't publish one on-chain. Jupiter Lend's six
// programs keep none (neither an `anchor:idl` account nor a Program Metadata one); these come from
// the public @jup-ag/lend SDK (0.4.0), docs stripped. An IDL found on-chain always wins.
// Each one is its own chunk, loaded only when a transaction touches that program.

export const BUNDLED_IDLS: Record<string, { name: string; load: () => Promise<unknown> }> = {
  jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi: {
    name: 'Jupiter Lend Vaults',
    load: () => import('./jup-lend-vaults.json'),
  },
  jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9: {
    name: 'Jupiter Lend Earn',
    load: () => import('./jup-lend-lending.json'),
  },
  jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC: {
    name: 'Jupiter Lend Liquidity',
    load: () => import('./jup-lend-liquidity.json'),
  },
  jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS: {
    name: 'Jupiter Lend Flashloan',
    load: () => import('./jup-lend-flashloan.json'),
  },
  jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd: {
    name: 'Jupiter Lend DEX',
    load: () => import('./jup-lend-dex.json'),
  },
  jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc: {
    name: 'Jupiter Lend Oracle',
    load: () => import('./jup-lend-oracle.json'),
  },
};
