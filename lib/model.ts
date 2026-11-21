// Token Launch Radar — valuation model.
//
// Question the model answers: if a protocol that records no token today were
// valued the way the market already values comparable tokenized protocols,
// what market capitalisation would its current TVL support? The answer is an
// estimate built only from the sealed snapshot's own numbers:
//
//   implied = TVL x peer multiple x momentum x maturity x breadth
//
// * peer multiple — the median market-cap/TVL ratio of tokenized protocols in
//   the same DefiLlama category, taken from this snapshot. Categories with
//   fewer than MIN_PEERS tokenized members fall back to the global median, so
//   no multiple ever rests on one or two names. Multiples are clamped.
// * momentum — the protocol's 7-day TVL change, clamped, scaled gently: a
//   fast-growing protocol is worth somewhat more than a shrinking one, never
//   an order of magnitude more.
// * maturity — older protocols (by the day DefiLlama first tracked them)
//   carry less launch risk, so age lifts the value inside a narrow band.
// * breadth — each extra chain beyond the first adds a small premium: a
//   multi-chain footprint is harder to replicate than a single deployment.
//
// Nothing is keyed to a protocol's name: one function scores every row, and
// the watchlist is a floor — every watchlist slug is ranked, plus every other
// rankable protocol that records no token.

/** One protocol exactly as the sealed snapshot carries it. */
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

/** Tunables of the peer-anchored model, printed in the dashboard's method note. */
export interface PeerModel {
  min_peers: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
  assumed_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const PEER_MODEL: PeerModel = {
  min_peers: 4,
  multiple_floor: 0.05,
  multiple_cap: 3,
  momentum_weight: 0.6,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  maturity_base: 0.75,
  maturity_span: 0.45,
  maturity_horizon_days: 1460,
  assumed_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_extra: 8,
};

export const MODEL_TAG = 'peer-radar-2';

/** The per-row arithmetic, kept on the row so anyone can recompute the value. */
export interface RowMath {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  peer_multiple: number;
  peer_count: number;
  chain_multiplier: number;
}

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
  farm_steps: string[];
}

/** A tokenized protocol, shown on the dashboard's live-peers strip at the market's own value. */
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
  peer_count: number;
  momentum: number;
  maturity: number;
  breadth: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** Everything data.js hands to the page. */
export interface DashData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_tag: string;
  model: PeerModel;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  peer_size: number;
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

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Whole days between the listing day and the snapshot day; null when unknown. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The middle value of a non-empty list of ratios. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Records no token: no market cap, no CoinGecko id and no symbol in the record. */
export function recordsNoToken(p: ProtocolEntry): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A trailing release tag in a name marks a deployment of another protocol, not a launch candidate. */
const RELEASE_SUFFIX = /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i;

/**
 * Categories that name a wrapped, staked or bridged product of a token that
 * already trades — the same families the snapshot's own watchlist rule sets
 * aside. A bridge's TVL is other protocols' assets in transit, not a launch
 * waiting to happen, so the radar never ranks these as candidates.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's own product, not an independent launch. */
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking in a name marks a derivative of a token that already trades. */
const DERIVATIVE_WORD = /\b(?:wrapped|staked|staking)\b/i;

/**
 * Rankable on the radar: records no token, and is a plausible independent
 * launch — not an exchange product, not a versioned deployment, and not a
 * wrapped, staked or bridged product of a token that already trades.
 */
export function isRankable(p: ProtocolEntry): boolean {
  if (!recordsNoToken(p)) return false;
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return false;
  const name = p.name.trim();
  return !RELEASE_SUFFIX.test(name) && !EXCHANGE_PREFIX.test(name) && !DERIVATIVE_WORD.test(name);
}

/** Category medians and the global median of market-cap/TVL across tokenized protocols. */
export interface PeerTable {
  byCategory: Map<string, { median: number; count: number }>;
  globalMedian: number;
  peerCount: number;
}

export function peerTable(snapshot: SnapshotDoc, model: PeerModel): PeerTable {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '';
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [ratio]);
    else bucket.push(ratio);
  }
  if (all.length === 0) return { byCategory: new Map(), globalMedian: model.multiple_floor, peerCount: 0 };
  const byCategory = new Map<string, { median: number; count: number }>();
  for (const [key, ratios] of buckets) {
    byCategory.set(key, {
      median: clamp(medianOf(ratios), model.multiple_floor, model.multiple_cap),
      count: ratios.length,
    });
  }
  return {
    byCategory,
    globalMedian: clamp(medianOf(all), model.multiple_floor, model.multiple_cap),
    peerCount: all.length,
  };
}

/** The multiple one protocol is scored with, and how many peers stand behind it. */
function multipleFor(p: ProtocolEntry, peers: PeerTable, model: PeerModel): { multiple: number; count: number } {
  const own = peers.byCategory.get(p.category ?? '');
  if (own !== undefined && own.count >= model.min_peers) return { multiple: own.median, count: own.count };
  return { multiple: peers.globalMedian, count: peers.peerCount };
}

/** The full scoring of one protocol: implied value plus every factor that produced it. */
export function scoreProtocol(
  p: ProtocolEntry,
  asOf: string,
  peers: PeerTable,
  model: PeerModel,
): { implied: number; math: RowMath } {
  const { multiple, count } = multipleFor(p, peers, model);
  const age = daysListed(asOf, p.listed_at);
  const growthPct = clamp(numOr(p.change_7d, 0), model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = round4(1 + (growthPct / 100) * model.momentum_weight);
  const effectiveAge = age ?? model.assumed_age_days;
  const maturity = round4(
    model.maturity_base + (clamp(effectiveAge, 0, model.maturity_horizon_days) / model.maturity_horizon_days) * model.maturity_span,
  );
  const extraChains = clamp(p.chains.length - 1, 0, model.breadth_max_extra);
  const breadth = round4(1 + extraChains * model.breadth_per_chain);
  const implied = clamp(Math.round(p.tvl_usd * multiple * momentum * maturity * breadth), 1, 100_000_000_000_000);
  return {
    implied,
    math: {
      base_multiple: multiple,
      growth_pct: growthPct,
      growth_multiplier: momentum,
      maturity_multiplier: maturity,
      age_days: age,
      peer_multiple: multiple,
      peer_count: count,
      chain_multiplier: breadth,
    },
  };
}

/** Working capital for one farm position, scaled to the protocol's size. */
function positionSize(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 50;
  return 25;
}

/** Weeks of presence a position should show, from the protocol's age. */
function holdWeeks(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 730) return 6;
  return 4;
}

function homeChain(p: ProtocolEntry): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
}

/** The opening position, phrased for the protocol's category family. */
function openingMove(p: ProtocolEntry, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${size} of USDC or ETH to ${n} on ${chain} so the wallet starts earning a supply balance there.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${size} of USDC through ${n} to ${chain} and leave the bridged funds working in a ${chain} app instead of bridging straight back.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${size} of the chain's staking asset through ${n} on ${chain} and keep the receipt token in the same wallet.`;
  }
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('options')) {
    return `Deposit $${size} of USDC margin into ${n} on ${chain} and open one small, hedged position you can leave running.`;
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return `Add $${size} of two-sided liquidity to ${n}'s busiest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${size} on ${n} and take one position in a liquid market so the account shows real trading history.`;
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('algo') || c.includes('reserve')) {
    return `Mint or deposit $${size} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('indexes')) {
    return `Deposit $${size} into a ${n} vault on ${chain} and keep the vault shares untouched while they accrue.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${size} of cover from ${n} on ${chain} and keep the policy active for its full term.`;
  }
  if (c.includes('privacy')) {
    return `Deposit $${size} through ${n} on ${chain} using its standard privacy flow, exactly as a regular user would.`;
  }
  return `Deposit $${size} of USDC into ${n} on ${chain} and keep the position open so the wallet builds a real usage history.`;
}

/** The second qualifying action, again by category family. */
function secondMove(p: ProtocolEntry, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow a small amount against the supply on ${n}, repay it in full a few days later, and repeat once so both sides of the market show activity.`;
  }
  if (c.includes('bridge')) {
    return `Route a second, differently sized transfer through ${n} on another day, and make a few swaps on ${chain} with the bridged funds.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Claim and re-stake the rewards on ${n} once, and if it runs a points program, link the wallet on its official points page.`;
  }
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('options')) {
    return `Trade a second small contract on ${n} in a different week, keeping total volume modest and the account consistently active.`;
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return `Make several ordinary swaps through ${n} on ${chain} across different days so the wallet shows trader activity, not only LP activity.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('indexes')) {
    return `Add a second, smaller deposit to the ${n} vault in a later week so the position history spans more than one snapshot period.`;
  }
  return `Repeat the core action on ${n} once more in a later week with a slightly different amount, so the history is not a single visit.`;
}

/** One step as a single line: the action, then its cost, then its time. */
function stepLine(action: string, cost: string, time: string): string {
  let line = `${action} Cost: ${cost}. Time: ${time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Keep the position open and re-check it weekly.`;
  return line;
}

/**
 * A five-step farm plan derived from the protocol's own record — its category
 * sets the actions, its TVL sets the position size, its age sets the hold.
 */
export function farmPlan(p: ProtocolEntry, age: number | null): string[] {
  const chain = homeChain(p);
  const size = positionSize(p.tvl_usd);
  const weeks = holdWeeks(age);
  const gas = size >= 250 ? 10 : 5;
  return [
    stepLine(
      `Prepare a dedicated farming wallet, fund it only from your main wallet, and send a $5 test transaction on ${chain} before committing real size.`,
      'under $3 of gas for the test',
      '10 minutes',
    ),
    stepLine(openingMove(p, size, chain), `$${size} of position capital plus roughly $${gas} of gas`, '15 minutes to set up'),
    stepLine(secondMove(p, size, chain), 'a few dollars of gas per action', '10 minutes per action'),
    stepLine(
      `Hold the ${p.name} position for at least ${weeks} weeks and make one small qualifying action each week, so the activity survives several weekly snapshots.`,
      `the $${size} stays deployed for the full hold`,
      `${weeks} weeks`,
    ),
    stepLine(
      `Each week, check ${p.name}'s official site and announcements for a points or rewards page, claim only through links the protocol itself publishes, and never pay a fee to claim an airdrop.`,
      'nothing to check; a claim fee is a scam signal',
      '5 minutes a week',
    ),
  ];
}

/** The ranked board: every watchlist slug, plus every other rankable pre-token protocol. */
export function buildBoard(snapshot: SnapshotDoc, model: PeerModel = PEER_MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
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
    const { implied, math } = scoreProtocol(p, snapshot.as_of, peers, model);
    return { p, implied, math };
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
    farm_steps: farmPlan(s.p, s.math.age_days),
  }));
}

/** The largest tokenized protocols by market cap, for the dashboard's peer strip. */
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
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Board rows reshaped for the page, plus the filter vocabularies. */
export function buildDashData(snapshot: SnapshotDoc, model: PeerModel = PEER_MODEL): { board: BoardRow[]; dash: DashData } {
  const board = buildBoard(snapshot, model);
  const peers = peerTable(snapshot, model);
  const watch = new Set(snapshot.watchlist);
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
    multiple: r.model.peer_multiple,
    peer_count: r.model.peer_count,
    momentum: r.model.growth_multiplier,
    maturity: r.model.maturity_multiplier,
    breadth: r.model.chain_multiplier,
    watchlist: watch.has(r.slug),
    farm_steps: r.farm_steps,
  }));
  const categories = [...new Set(rows.map((r) => r.category ?? 'Uncategorized'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  return {
    board,
    dash: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_tag: MODEL_TAG,
      model,
      universe_size: snapshot.protocols.length,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      peer_size: peers.peerCount,
      rows,
      live: livePeers(snapshot),
      categories,
      chains,
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
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why this board would fail the gate, or null when it passes: coverage, ranks, order, values, steps. */
export function boardProblem(board: BoardRow[], snapshot: SnapshotDoc): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the gate's 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows, more than the gate's 4000`;
  const present = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !present.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} carries rank ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
    const row = board[i]!;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} carries implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} carries a farm step of ${step.length} characters`;
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
