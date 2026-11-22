// Token Launch Radar — entry program (Node 22, standard library only).
//
// Pipeline: read the sealed snapshot, score every rankable protocol that
// records no token with the fitted model in lib/model.ts, refuse the run
// if the board would fail the gate, then write the hand-in set — board.json
// (the ranked board), data.js (the dashboard's dataset), a copy of
// dashboard/ and screenshots/, and finally dossier.json from the vendored
// make.fun library, written last because the scorer rebuilds the dossier
// from the finished output directory and compares bytes.
//
//   node main.ts --input <snapshot.json|dir> [--output <dir>]
//
// Without --output, MAKEFUN_OUTPUT_DIR stands in for /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblem, buildDashData, readSnapshot, toDataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Caps for the dossier library: the text cap shapes bytes; the rest only refuse. */
const TEXT_CAP = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the argument list. */
function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1];
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? undefined : joined.slice(name.length + 3);
}

function die(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argValue('input') ?? '/input';
const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  die(`no snapshot at ${snapshotFile} — pass --input <snapshot.json|directory>`);
}
const outDir = argValue('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = readSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, dash } = buildDashData(snapshot);
const problem = boardProblem(board, snapshot);
if (problem !== null) die(`the model produced a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), toDataScript(dash));

/** Copy one directory's regular, non-hidden files into another; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const dashNames = copyDir(join(HERE, 'dashboard'), join(outDir, 'dashboard'));
const shotNames = copyDir(join(HERE, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3) {
  die(`screenshots/ holds ${shotNames.length} images — hand in 3: the board, a detail view and a filtered view`);
}
for (const name of shotNames) {
  if (!PLAIN_SHOT_NAME.test(name)) die(`screenshots/${name} — a name is letters, digits and . _ -, 1 to 128 characters`);
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAPS, dashboard: DASH_CAPS }),
);

const lead = board[0];
const v = dash.validation;
const vc = dash.verdict_counts;
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} candidates ranked (${vc.Farm} Farm, ${vc.Thin} Thin, ${vc.Skip} Skip), ${dash.peer_size} tokenized peers behind the fit\n` +
    `token-radar: held-out check on ${v.test_peers} unseen peers: median error x${(10 ** v.median_abs_log10_error).toFixed(2)}, ` +
    `${v.within_2x_pct}% within 2x, ${v.within_3x_pct}% within 3x\n` +
    (lead === undefined
      ? ''
      : `token-radar: top of the board: ${lead.name} at $${lead.implied_value_usd.toLocaleString('en-US')} implied, verdict ${lead.verdict}\n`) +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashNames.length} files), screenshots/ (${shotNames.length} images), dossier.json -> ${outDir}\n`,
);
