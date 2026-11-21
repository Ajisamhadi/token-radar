// Token Launch Radar — entry program (Node 22, standard library only).
//
// Reads the sealed protocol snapshot, scores every rankable protocol that
// records no token with the peer-anchored model in lib/model.ts, and writes
// the hand-in set: board.json (the ranked board), data.js (the dashboard's
// dataset), a copy of dashboard/ and screenshots/, and dossier.json written
// by the vendored make.fun library — last, because the scorer rebuilds the
// dossier from the finished output and compares bytes.
//
//   node main.ts --input <snapshot.json|dir> [--output <dir>]
//
// With no --output, MAKEFUN_OUTPUT_DIR stands in for /output outside the
// grader's container.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblem, buildDashData, readSnapshot, toDataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Caps handed to the dossier library: the text cap shapes the bytes, the rest only refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const DOSSIER_SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? undefined : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flagValue('input') ?? '/input';
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flagValue('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = readSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, dash } = buildDashData(snapshot);
const problem = boardProblem(board, snapshot);
if (problem !== null) fail(`the model produced a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), toDataScript(dash));

/** Copy the regular, non-hidden files of one directory into another; returns the names copied. */
function mirrorDir(from: string, to: string): string[] {
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

const dashFiles = mirrorDir(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = mirrorDir(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3) {
  fail(`screenshots/ holds ${shotFiles.length} images — hand in 3: the board, a detail view and a filtered view`);
}
for (const name of shotFiles) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name} — a name is letters, digits and . _ -, 1 to 128 characters`);
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: DOSSIER_SHOT_CAPS, dashboard: DOSSIER_DASH_CAPS }),
);

const top = board[0];
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols in the universe, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked, ${dash.peer_size} tokenized peers behind the multiples\n` +
    (top === undefined ? '' : `token-radar: top of the board: ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied\n`) +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shotFiles.length} images), dossier.json -> ${outDir}\n`,
);
