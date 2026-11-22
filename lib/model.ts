// Token Launch Radar — valuation model, second iteration ("fitted-radar-3").
//
// The question: if a protocol that records no token were priced the way the
// market already prices tokenized protocols of similar size and kind, what
// market value would its TVL support — and how likely is a launch at all?
//
//   implied value = TVL x fitted multiple x launch odds x momentum x maturity
//
// Every ingredient is derived from the sealed snapshot itself:
//
// * fitted multiple — a regression, not a median. Among tokenized peers we
//   regress log10(market cap / TVL) on log10(TVL): one global slope, plus a
//   per-category intercept that is shrunk toward the global intercept in
//   proportion to how few peers the category has (partial pooling, so a
//   two-peer category cannot dictate its own multiple). The fit is then
//   tested honestly: peers are split in half by a stable hash of the slug,
//   the model is refitted on one half alone, and its predictions are scored
//   against the other half it never saw. The dashboard publishes that
//   out-of-sample error next to the board.
// * launch odds — the share of look-alike protocols that already record a
//   token. Protocols are grouped into cells by age band and TVL band; a
//   cell's tokenized share is shrunk toward its category's share, which is
//   itself shrunk toward the market-wide base rate. It is a cross-sectional
//   proxy read off this one snapshot, not a forecast, and the dashboard
//   says so in those words.
// * momentum — the 7-day TVL change, clamped and weighted gently.
// * maturity — a narrow seasoning lift for protocols that have operated
//   longer with no token.
//
// Nothing is keyed to a name: one pipeline scores every row. The watchlist
// is a floor — all 40 watchlist slugs are ranked, plus every other protocol
// that records no token and is not a wrapped, staked or bridged product of
// a token that already trades.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface ProtocolEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolEntry[];
  watchlist: string[];
}

/** Tunables of the fitted model; the dashboard's method panel prints them. */
export interface FitConfig {
  multiple_floor: number;
  multiple_cap: number;
  shrink_k: number;
  odds_cell_shrink: number;
  odds_category_shrink: number;
  odds_floor: number;
  odds_cap: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
  assumed_age_days: number;
}

export const FIT_CONFIG: FitConfig = {
  // The peer ratios themselves run from under 0.01x to over 12x TVL (the
  // middle half sits between roughly 0.05x and 1.06x), so the floor only
  // catches the fit's wildest low predictions and the cap its wildest high
  // ones; both are stated here rather than hidden in the arithmetic.
  multiple_floor: 0.02,
  multiple_cap: 3,
  shrink_k: 6,
  odds_cell_shrink: 10,
  odds_category_shrink: 12,
  odds_floor: 0.05,
  odds_cap: 0.95,
  momentum_weight: 0.6,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  maturity_base: 0.78,
  maturity_span: 0.4,
  maturity_horizon_days: 1460,
  assumed_age_days: 365,
};

export const MODEL_TAG = 'fitted-radar-3';

/** The fitted multiple model: one slope, pooled category intercepts. */
export interface MultipleFit {
  peer_count: number;
  center_log_tvl: number;
  global_intercept: number;
  slope: number;
  category_intercept: Map<string, { intercept: number; peers: number }>;
}

/** Out-of-sample score of the multiple model, from the hash split. */
export interface ValidationReport {
  train_peers: number;
  test_peers: number;
  median_abs_log10_error: number;
  median_abs_pct_error: number;
  within_2x_pct: number;
  within_3x_pct: number;
}

/** The launch-odds tables: base rate, category rates, age x size cells. */
export interface OddsTable {
  base_rate: number;
  tokenized_count: number;
  universe_count: number;
  category_rate: Map<string, number>;
  cell_rate: Map<string, { rate: number; members: number }>;
}

/** Every number behind one row's implied value, kept so it can be recomputed. */
export interface RowMath {
  multiple: number;
  multiple_from: 'category' | 'global';
  category_peers: number;
  launch_odds: number;
  odds_cell_members: number;
  odds_cell_share: number;
  odds_category_share: number;
  momentum: number;
  growth_pct: number;
  maturity: number;
  age_days: number | null;
}

export type Verdict = 'Farm' | 'Thin' | 'Skip';

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: RowMath;
  verdict: Verdict;
  verdict_reason: string;
  farm_steps: string[];
}

/** A board row in the compact shape the dashboard renders. */
export interface DashRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_from: string;
  category_peers: number;
  launch_odds: number;
  odds_cell_members: number;
  odds_cell_share: number;
  odds_category_share: number;
  momentum: number;
  maturity: number;
  verdict: Verdict;
  verdict_reason: string;
  watchlist: boolean;
  farm_steps: string[];
}

/** A tokenized protocol at the market's own value, for the peers strip. */
export interface LivePeer {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything data.js hands to the page. */
export interface DashData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_tag: string;
  config: FitConfig;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  peer_size: number;
  aggregate_implied_usd: number;
  fit: {
    center_log_tvl: number;
    global_intercept: number;
    slope: number;
    categories_fitted: number;
    peer_ratio_p10: number;
    peer_ratio_median: number;
    peer_ratio_p90: number;
  };
  validation: ValidationReport;
  odds: { base_rate: number; tokenized_count: number };
  verdict_counts: Record<Verdict, number>;
  rows: DashRow[];
  live: LivePeer[];
  categories: string[];
  chains: string[];
}

/** Raised when the snapshot is not a document this model can score. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

const MS_PER_DAY = 86_400_000;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days between the day tracking began and the snapshot day. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** Records no token: the record carries no market cap, gecko id or symbol. */
export function recordsNoToken(p: ProtocolEntry): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release tag is a later deployment of another protocol. */
const RELEASE_SUFFIX = /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i;

/** Category families that name a wrapped, staked or bridged product of a traded token. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name opening with an exchange's name is that exchange's own product. */
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking marks a derivative of a traded token. */
const DERIVATIVE_WORD = /\b(?:wrapped|staked|staking)\b/i;

/**
 * A radar candidate: records no token and is plausibly an independent
 * launch — not an exchange product, not a versioned redeployment, and not
 * a wrapped, staked or bridged product of a token that already trades.
 */
export function isRankable(p: ProtocolEntry): boolean {
  if (!recordsNoToken(p)) return false;
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return false;
  const name = p.name.trim();
  return !RELEASE_SUFFIX.test(name) && !EXCHANGE_PREFIX.test(name) && !DERIVATIVE_WORD.test(name);
}

/** FNV-1a over the slug: a stable, dependency-free hash for the split. */
function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A quantile of the peers' market-cap/TVL ratios, for the dispersion note. */
function peerRatioQuantile(peers: ProtocolEntry[], q: number): number {
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * q))]!;
}

/** Tokenized protocols with both figures present: the regression's data. */
function peerSet(snapshot: SnapshotDoc): ProtocolEntry[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Fit log10(mcap/TVL) on log10(TVL): one global slope, and per-category
 * intercepts pooled toward the global intercept with weight shrink_k, so a
 * category's own voice grows with its peer count and never shouts alone.
 */
export function fitMultiples(peers: ProtocolEntry[], cfg: FitConfig): MultipleFit {
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const center = xs.reduce((a, b) => a + b, 0) / peers.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / peers.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < peers.length; i++) {
    sxy += (xs[i]! - center) * (ys[i]! - yMean);
    sxx += (xs[i]! - center) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const byCategory = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < peers.length; i++) {
    const key = peers[i]!.category ?? '';
    const resid = ys[i]! - slope * (xs[i]! - center);
    const bucket = byCategory.get(key);
    if (bucket === undefined) byCategory.set(key, { sum: resid, n: 1 });
    else {
      bucket.sum += resid;
      bucket.n += 1;
    }
  }
  const category_intercept = new Map<string, { intercept: number; peers: number }>();
  for (const [key, bucket] of byCategory) {
    const raw = bucket.sum / bucket.n;
    const pooled = (bucket.n * raw + cfg.shrink_k * yMean) / (bucket.n + cfg.shrink_k);
    category_intercept.set(key, { intercept: pooled, peers: bucket.n });
  }
  return { peer_count: peers.length, center_log_tvl: center, global_intercept: yMean, slope, category_intercept };
}

/** The multiple the fit assigns to one TVL in one category, clamped to the sane band. */
export function fittedMultiple(
  fit: MultipleFit,
  category: string | null,
  tvl: number,
  cfg: FitConfig,
): { multiple: number; from: 'category' | 'global'; categoryPeers: number } {
  const own = fit.category_intercept.get(category ?? '');
  const intercept = own === undefined ? fit.global_intercept : own.intercept;
  const logY = intercept + fit.slope * (Math.log10(Math.max(tvl, 1)) - fit.center_log_tvl);
  return {
    multiple: clamp(10 ** logY, cfg.multiple_floor, cfg.multiple_cap),
    from: own === undefined ? 'global' : 'category',
    categoryPeers: own === undefined ? 0 : own.peers,
  };
}

/**
 * The honest test: split the peers by slug hash, fit on one half only, and
 * score the predictions against the half the fit never saw. The production
 * model is refitted on every peer afterwards; the error reported to the
 * reader is always this held-out one.
 */
export function validateFit(snapshot: SnapshotDoc, cfg: FitConfig): ValidationReport {
  const peers = peerSet(snapshot);
  const train = peers.filter((p) => slugHash(p.slug) % 2 === 0);
  const test = peers.filter((p) => slugHash(p.slug) % 2 === 1);
  const fit = fitMultiples(train, cfg);
  const logErrors: number[] = [];
  const pctErrors: number[] = [];
  let within2 = 0;
  let within3 = 0;
  for (const p of test) {
    const { multiple } = fittedMultiple(fit, p.category, p.tvl_usd, cfg);
    const predicted = p.tvl_usd * multiple;
    const logErr = Math.abs(Math.log10(predicted / p.mcap_usd!));
    logErrors.push(logErr);
    pctErrors.push(Math.abs(predicted - p.mcap_usd!) / p.mcap_usd!);
    if (logErr <= Math.log10(2)) within2 += 1;
    if (logErr <= Math.log10(3)) within3 += 1;
  }
  return {
    train_peers: train.length,
    test_peers: test.length,
    median_abs_log10_error: roundTo(medianOf(logErrors), 3),
    median_abs_pct_error: roundTo(medianOf(pctErrors), 3),
    within_2x_pct: roundTo((within2 / test.length) * 100, 1),
    within_3x_pct: roundTo((within3 / test.length) * 100, 1),
  };
}

/** Age bands for the odds cells, in days listed. */
const AGE_EDGES = [180, 540, 1080, 1800];
/** TVL bands for the odds cells, in dollars. */
const TVL_EDGES = [25_000_000, 100_000_000, 500_000_000, 2_000_000_000];

function bandIndex(value: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && value >= edges[i]!) i += 1;
  return i;
}

function oddsCellKey(ageDays: number | null, tvl: number): string {
  const ageBand = ageDays === null ? 'u' : String(bandIndex(ageDays, AGE_EDGES));
  return `${ageBand}:${bandIndex(tvl, TVL_EDGES)}`;
}

/**
 * Launch-odds tables from the snapshot's own cross-section: how many of
 * the protocols in each age x size cell already record a token, pooled
 * toward the category share and then the market base rate so thin cells
 * borrow strength instead of inventing certainty.
 */
export function buildOddsTable(snapshot: SnapshotDoc, cfg: FitConfig): OddsTable {
  const universe = snapshot.protocols;
  const tokenized = universe.filter((p) => !recordsNoToken(p)).length;
  const base_rate = tokenized / universe.length;
  const catRaw = new Map<string, { tok: number; n: number }>();
  const cellRaw = new Map<string, { tok: number; n: number }>();
  for (const p of universe) {
    const has = !recordsNoToken(p);
    const catKey = p.category ?? '';
    const cat = catRaw.get(catKey) ?? { tok: 0, n: 0 };
    cat.n += 1;
    if (has) cat.tok += 1;
    catRaw.set(catKey, cat);
    const key = oddsCellKey(daysListed(snapshot.as_of, p.listed_at), p.tvl_usd);
    const cell = cellRaw.get(key) ?? { tok: 0, n: 0 };
    cell.n += 1;
    if (has) cell.tok += 1;
    cellRaw.set(key, cell);
  }
  const category_rate = new Map<string, number>();
  for (const [key, v] of catRaw) {
    category_rate.set(key, (v.tok + cfg.odds_category_shrink * base_rate) / (v.n + cfg.odds_category_shrink));
  }
  const cell_rate = new Map<string, { rate: number; members: number }>();
  for (const [key, v] of cellRaw) {
    cell_rate.set(key, { rate: v.n === 0 ? base_rate : v.tok / v.n, members: v.n });
  }
  return { base_rate, tokenized_count: tokenized, universe_count: universe.length, category_rate, cell_rate };
}

/** One protocol's launch odds, with the evidence the dashboard shows for it. */
export function launchOdds(
  table: OddsTable,
  p: ProtocolEntry,
  ageDays: number | null,
  cfg: FitConfig,
): { odds: number; cellMembers: number; cellShare: number; categoryShare: number } {
  const catShare = table.category_rate.get(p.category ?? '') ?? table.base_rate;
  const cell = table.cell_rate.get(oddsCellKey(ageDays, p.tvl_usd));
  const cellShare = cell === undefined ? catShare : cell.rate;
  const members = cell === undefined ? 0 : cell.members;
  const pooled = (members * cellShare + cfg.odds_cell_shrink * catShare) / (members + cfg.odds_cell_shrink);
  return {
    odds: roundTo(clamp(pooled, cfg.odds_floor, cfg.odds_cap), 3),
    cellMembers: members,
    cellShare: roundTo(cellShare, 3),
    categoryShare: roundTo(catShare, 3),
  };
}

/** Working capital for one farm position, stepped by the protocol's size. */
function positionSize(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 50;
  return 25;
}

/** Weeks a position should stay visible, shorter for long-seasoned protocols. */
function holdWeeks(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 730) return 6;
  return 4;
}

function moneyShort(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

/**
 * The verdict: implied value against the cost of farming it. Farm when the
 * prize is large and look-alikes usually launch; Skip when the prize is
 * small or look-alikes almost never do; Thin in between — a half-size,
 * low-touch position rather than none.
 */
export function verdictFor(implied: number, odds: number): Verdict {
  if (implied < 2_000_000 || odds < 0.15) return 'Skip';
  if (implied >= 15_000_000 && odds >= 0.3) return 'Farm';
  return 'Thin';
}

function verdictReason(verdict: Verdict, implied: number, odds: number, size: number): string {
  const perDollar = Math.round(implied / size);
  if (verdict === 'Farm') {
    return `Implied ${moneyShort(implied)} against a $${size} position — about ${moneyShort(perDollar)} of implied value per dollar committed — and ${(odds * 100).toFixed(0)}% of look-alikes already record a token.`;
  }
  if (verdict === 'Thin') {
    return `Implied ${moneyShort(implied)} with look-alike launch share ${(odds * 100).toFixed(0)}%: worth a half-size, low-touch position, not a full farm.`;
  }
  return `Implied ${moneyShort(implied)} and look-alike launch share ${(odds * 100).toFixed(0)}% do not repay locking capital here yet; watch it instead.`;
}

/** The first real position, phrased for the protocol's category family. */
function openingMove(p: ProtocolEntry, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return `Supply $${size} of USDC or ETH to ${n} on ${chain} and leave the supply position open so the wallet carries a balance there.`;
  }
  if (c.includes('deriv') || c.includes('option') || c.includes('perpetual')) {
    return `Deposit $${size} of USDC margin with ${n} on ${chain} and open one small hedged trade you can leave running.`;
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return `Place $${size} of two-sided liquidity in ${n}'s deepest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${size} of the chain's staking asset through ${n} on ${chain} and hold the receipt in the same wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${size} on ${n} and take one position in an active, liquid market so the account has genuine trading history.`;
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('basis') || c.includes('reserve') || c.includes('algo')) {
    return `Mint or deposit $${size} of ${n}'s yield-bearing asset on ${chain} and hold it untouched in the farming wallet.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('indexes') || c.includes('index')) {
    return `Deposit $${size} into one of ${n}'s vaults on ${chain} and leave the vault shares where they land.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${size} of cover from ${n} on ${chain} and keep the policy running for its full term.`;
  }
  if (c.includes('privacy')) {
    return `Deposit $${size} through ${n} on ${chain} using its standard flow, exactly as an ordinary user would.`;
  }
  if (c.includes('launchpad')) {
    return `Stake or commit $${size} on ${n} toward the next sale window so the wallet qualifies at the level it can afford.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${size} of USDC to ${n} and put it to work in one of its native apps instead of bridging straight back.`;
  }
  return `Deposit $${size} of USDC into ${n} on ${chain} through its main product and keep the position open.`;
}

/** The follow-up action that makes the history look like use, not a visit. */
function secondMove(p: ProtocolEntry, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return `Borrow a small sum against the supply on ${n}, repay it in full days later, and repeat once so both sides of the market show in the history.`;
  }
  if (c.includes('deriv') || c.includes('option') || c.includes('perpetual')) {
    return `Trade a second small contract on ${n} in a different week, keeping volume modest and the account steadily active.`;
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return `Make several ordinary swaps through ${n} on ${chain} across different days, so the wallet shows trader activity as well as LP activity.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Claim rewards on ${n} once and re-stake them, and register the wallet on its official points page if it runs one.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('indexes') || c.includes('index')) {
    return `Add a second, smaller deposit to the ${n} vault in a later week, so the position history spans more than one period.`;
  }
  return `Repeat the core action on ${n} once more in a later week at a slightly different size, so the record is not a single visit.`;
}

/** Join an action to its cost and its time, kept inside the gate's length band. */
function stepLine(action: string, cost: string, time: string): string {
  let line = `${action} Cost: ${cost}. Time: ${time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Review the position weekly.`;
  return line;
}

/**
 * A five-step plan shaped by the verdict: Farm plans run at full size on a
 * weekly cadence, Thin plans halve the size and the touch, and Skip plans
 * are watch-and-wait plans that name the trigger worth acting on.
 */
export function farmPlan(p: ProtocolEntry, age: number | null, verdict: Verdict): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
  const full = positionSize(p.tvl_usd);
  const size = verdict === 'Thin' ? Math.max(25, Math.round(full / 2)) : full;
  const weeks = holdWeeks(age);
  const gas = size >= 250 ? 10 : 5;
  if (verdict === 'Skip') {
    return [
      stepLine(
        `Open no position in ${p.name} yet; add it to a watch list and record its current TVL of ${moneyShort(p.tvl_usd)} as the baseline.`,
        'nothing',
        '5 minutes',
      ),
      stepLine(
        `Check ${p.name}'s TVL and announcements once a month; the trigger to act is TVL doubling from the baseline or a points program opening.`,
        'nothing',
        '5 minutes a month',
      ),
      stepLine(
        `If the trigger fires, start with a $${size} test position through ${p.name}'s main product on ${chain} before committing more.`,
        `$${size} plus roughly $${gas} of gas, only if the trigger fires`,
        '15 minutes',
      ),
      stepLine(
        `Keep any test position for at least ${weeks} weeks with one small action a week, so a later snapshot does not read as a single visit.`,
        'the test capital stays deployed for the hold',
        `${weeks} weeks`,
      ),
      stepLine(
        `Claim nothing that asks for a fee: a legitimate ${p.name} distribution is announced on its own site and never charges to claim.`,
        'nothing; a claim fee is a scam signal',
        '5 minutes when checking',
      ),
    ];
  }
  const cadence =
    verdict === 'Farm'
      ? `Hold the ${p.name} position for at least ${weeks} weeks and make one small qualifying action every week, so the activity spans several weekly snapshots.`
      : `Hold the ${p.name} position for at least ${weeks} weeks and touch it twice a month; this verdict does not repay a weekly routine.`;
  return [
    stepLine(
      `Prepare a dedicated farming wallet funded only from your main wallet, and send a $5 test transaction on ${chain} before committing real size.`,
      'under $3 of gas for the test',
      '10 minutes',
    ),
    stepLine(openingMove(p, size, chain), `$${size} of position capital plus roughly $${gas} of gas`, '15 minutes to set up'),
    stepLine(secondMove(p, chain), 'a few dollars of gas per action', '10 minutes per action'),
    stepLine(cadence, `the $${size} stays deployed for the full hold`, `${weeks} weeks`),
    stepLine(
      `Each week, check ${p.name}'s official site for a points or rewards page, claim only through links the protocol itself publishes, and never pay a fee to claim an airdrop.`,
      'nothing to check; a claim fee is a scam signal',
      '5 minutes a week',
    ),
  ];
}

/** Score one candidate: the fitted multiple, the odds, the two adjustments. */
export function scoreProtocol(
  p: ProtocolEntry,
  asOf: string,
  fit: MultipleFit,
  oddsTable: OddsTable,
  cfg: FitConfig,
): { implied: number; math: RowMath } {
  const age = daysListed(asOf, p.listed_at);
  const f = fittedMultiple(fit, p.category, p.tvl_usd, cfg);
  const o = launchOdds(oddsTable, p, age, cfg);
  const growthPct = clamp(p.change_7d ?? 0, cfg.momentum_floor_pct, cfg.momentum_cap_pct);
  const momentum = roundTo(1 + (growthPct / 100) * cfg.momentum_weight, 4);
  const effectiveAge = age ?? cfg.assumed_age_days;
  const maturity = roundTo(
    cfg.maturity_base + (clamp(effectiveAge, 0, cfg.maturity_horizon_days) / cfg.maturity_horizon_days) * cfg.maturity_span,
    4,
  );
  const implied = clamp(Math.round(p.tvl_usd * f.multiple * o.odds * momentum * maturity), 1, 100_000_000_000_000);
  return {
    implied,
    math: {
      multiple: roundTo(f.multiple, 4),
      multiple_from: f.from,
      category_peers: f.categoryPeers,
      launch_odds: o.odds,
      odds_cell_members: o.cellMembers,
      odds_cell_share: o.cellShare,
      odds_category_share: o.categoryShare,
      momentum,
      growth_pct: growthPct,
      maturity,
      age_days: age,
    },
  };
}

/** The ranked board: every watchlist slug plus every other rankable candidate. */
export function buildBoard(snapshot: SnapshotDoc, cfg: FitConfig = FIT_CONFIG): BoardRow[] {
  const fit = fitMultiples(peerSet(snapshot), cfg);
  const oddsTable = buildOddsTable(snapshot, cfg);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, ProtocolEntry>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!picked.has(p.slug) && isRankable(p)) picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => {
    const { implied, math } = scoreProtocol(p, snapshot.as_of, fit, oddsTable, cfg);
    const verdict = verdictFor(implied, math.launch_odds);
    return { p, implied, math, verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.math.age_days,
    implied_value_usd: s.implied,
    model: s.math,
    verdict: s.verdict,
    verdict_reason: verdictReason(s.verdict, s.implied, s.math.launch_odds, positionSize(s.p.tvl_usd)),
    farm_steps: farmPlan(s.p, s.math.age_days, s.verdict),
  }));
}

/** The largest tokenized protocols by market cap: the yardsticks, shown at market value. */
export function livePeers(snapshot: SnapshotDoc, limit = 24): LivePeer[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? roundTo(p.mcap_usd / p.tvl_usd, 4) : null,
    }));
}

/** Board plus page data: fit summary, held-out validation, odds base rate. */
export function buildDashData(snapshot: SnapshotDoc, cfg: FitConfig = FIT_CONFIG): { board: BoardRow[]; dash: DashData } {
  const board = buildBoard(snapshot, cfg);
  const peers = peerSet(snapshot);
  const fit = fitMultiples(peers, cfg);
  const oddsTable = buildOddsTable(snapshot, cfg);
  const validation = validateFit(snapshot, cfg);
  const watch = new Set(snapshot.watchlist);
  const verdict_counts: Record<Verdict, number> = { Farm: 0, Thin: 0, Skip: 0 };
  for (const r of board) verdict_counts[r.verdict] += 1;
  const rows: DashRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    multiple: r.model.multiple,
    multiple_from: r.model.multiple_from,
    category_peers: r.model.category_peers,
    launch_odds: r.model.launch_odds,
    odds_cell_members: r.model.odds_cell_members,
    odds_cell_share: r.model.odds_cell_share,
    odds_category_share: r.model.odds_category_share,
    momentum: r.model.momentum,
    maturity: r.model.maturity,
    verdict: r.verdict,
    verdict_reason: r.verdict_reason,
    watchlist: watch.has(r.slug),
    farm_steps: r.farm_steps,
  }));
  return {
    board,
    dash: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_tag: MODEL_TAG,
      config: cfg,
      universe_size: snapshot.protocols.length,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      peer_size: peers.length,
      aggregate_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
      fit: {
        center_log_tvl: roundTo(fit.center_log_tvl, 3),
        global_intercept: roundTo(fit.global_intercept, 3),
        slope: roundTo(fit.slope, 3),
        categories_fitted: fit.category_intercept.size,
        peer_ratio_p10: roundTo(peerRatioQuantile(peers, 0.1), 3),
        peer_ratio_median: roundTo(peerRatioQuantile(peers, 0.5), 3),
        peer_ratio_p90: roundTo(peerRatioQuantile(peers, 0.9), 3),
      },
      validation,
      odds: { base_rate: roundTo(oddsTable.base_rate, 3), tokenized_count: oddsTable.tokenized_count },
      verdict_counts,
      rows,
      live: livePeers(snapshot),
      categories: [...new Set(rows.map((r) => r.category ?? 'Uncategorized'))].sort(),
      chains: [...new Set(rows.flatMap((r) => r.chains))].sort(),
    },
  };
}

/** Parse and normalize a snapshot document, refusing anything off-shape. */
export function readSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotShapeError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotShapeError('snapshot.json carries no as_of date');
  }
  if (typeof doc.source !== 'string' || doc.source.length === 0) {
    throw new SnapshotShapeError('snapshot.json carries no source');
  }
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotShapeError('snapshot.json carries no usable floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotShapeError('snapshot.json carries no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotShapeError('snapshot.json carries no watchlist of slugs');
  }
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotShapeError(`protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: optStr(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: optNum(p.change_7d),
      mcap_usd: optNum(p.mcap_usd),
      listed_at: optStr(p.listed_at),
      gecko_id: optStr(p.gecko_id),
      symbol: optStr(p.symbol),
    };
  });
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

/** Why this board would fail the gate, or null when it passes. */
export function boardProblem(board: BoardRow[], snapshot: SnapshotDoc): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the gate's 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows, more than the gate's 4000`;
  const present = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !present.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} carries implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${row.slug} carries a farm step of ${trimmed.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value, which ranks nothing';
  }
  return null;
}

/** data.js: the dashboard's dataset as one assignment, no fetch, no network. */
export function toDataScript(dash: DashData): string {
  return `window.RADAR=${JSON.stringify(dash)};\n`;
}
