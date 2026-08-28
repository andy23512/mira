#!/usr/bin/env node
/**
 * Downloads the sheets of "Tangent's Unofficial CharaChorder and Forge Learning
 * Progress Statistic" as CSV into data/raw/.
 *
 * The source spreadsheet is private; what this reads is its "publish to web"
 * mirror, so no credentials are involved. Only sheets that have been published
 * are reachable — publishing a new one makes it show up here automatically,
 * there is no gid list to keep in sync.
 *
 * Source sheet (edit access required):
 *   https://docs.google.com/spreadsheets/d/1okhYnt4cz8Zzh2WKNzPs9drqaoudCeT7VN2O9UzTTFM/edit
 *
 * Usage:
 *   node scripts/fetch-sheets.mjs                     download the sheets Mira reads
 *   node scripts/fetch-sheets.mjs --all               download every published sheet
 *   node scripts/fetch-sheets.mjs --list              show what is published, download nothing
 *   node scripts/fetch-sheets.mjs --only "Processed Data,Coefficients"
 *   node scripts/fetch-sheets.mjs --out data/raw
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The id minted by File > Share > Publish to web on the source spreadsheet. */
const PUBLISHED_ID =
	'2PACX-1vQ-GIGZcyrT2rhcVUUot14X00CK7XrqMDSI4gqKdE_8jQtrFqId4hD9-UvE6TS9RZjpaHkmyjfgEBZ6';

/**
 * What build-curves.mjs reads. The spreadsheet also publishes chart-only sheets and
 * pre-computed statistics that Mira does not use, so they are left alone rather than
 * downloaded into the repository on every refresh. `--all` still fetches everything.
 */
const REQUIRED_SHEETS = ['Processed Data'];

const BASE = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Google occasionally stalls a connection instead of refusing it. */
const TIMEOUT_MS = 30_000;

const get = (url) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });

function parseArgs(argv) {
	const args = { list: false, all: false, only: null, out: 'data/raw' };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--list') args.list = true;
		else if (arg === '--all') args.all = true;
		else if (arg === '--only') args.only = splitNames(argv[++i]);
		else if (arg.startsWith('--only=')) args.only = splitNames(arg.slice(7));
		else if (arg === '--out') args.out = argv[++i];
		else if (arg.startsWith('--out=')) args.out = arg.slice(6);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

const splitNames = (value) =>
	String(value ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);

/**
 * Google serves a sign-in page instead of an error status when something is not
 * published, so a 200 alone does not mean we got a sheet.
 */
async function fetchText(url, what) {
	const response = await get(url);
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`${what}: HTTP ${response.status}. The sheet is probably not published — ` +
				`open the spreadsheet, File > Share > Publish to web, and publish it.`,
		);
	}
	if (/^\s*<(!doctype|html)/i.test(body)) {
		throw new Error(
			`${what}: got an HTML page where CSV was expected. This is Google's sign-in ` +
				`page, which means the sheet is not published to the web.`,
		);
	}
	return body;
}

/**
 * The published viewer builds its sheet tabs in an inline script, one
 * `items.push({name: "...", ..., gid: "..."})` per sheet. That list is the only
 * place the published sheet names and gids appear together.
 */
async function discoverSheets() {
	const response = await get(`${BASE}/pubhtml`);
	if (!response.ok) {
		throw new Error(
			`Could not load the published view (HTTP ${response.status}). ` +
				`Check that PUBLISHED_ID is still current.`,
		);
	}
	const html = await response.text();
	const sheets = [...html.matchAll(/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)".*?gid:\s*"(\d+)"/g)].map(
		([, name, gid]) => ({ name: decodeName(name), gid }),
	);
	if (sheets.length === 0) {
		throw new Error('The published view listed no sheets. Its markup may have changed.');
	}
	return sheets;
}

/** Sheet names arrive JS-escaped (\x22, 學, \/ …) inside the inline script. */
const decodeName = (raw) =>
	raw.replace(/\\x([\da-f]{2})|\\u([\da-f]{4})|\\(.)/gi, (_, hex2, hex4, char) =>
		hex2 || hex4 ? String.fromCharCode(parseInt(hex2 || hex4, 16)) : char,
	);

/** Keeps CJK names readable; only strips what a filesystem or git would object to. */
const toFileName = (name) => `${name.replace(/[\\/:*?"<>|]/g, '-').trim()}.csv`;

/** Rows x columns of the downloaded CSV, so a truncated download is visible. */
function shapeOf(csv) {
	const rows = csv.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
	return { rows: rows.length, columns: rows[0] ? rows[0].split(',').length : 0 };
}

/**
 * The manifest describes every CSV sitting in the output directory. Entries for
 * sheets this run skipped are carried over rather than dropped, but only while
 * their file is still there — deleting a CSV takes it out of the manifest too.
 */
async function writeManifest(outDir, downloaded) {
	const path = join(outDir, 'manifest.json');
	let previous = [];
	try {
		previous = JSON.parse(await readFile(path, 'utf8')).sheets ?? [];
	} catch {
		// No manifest yet, or an unreadable one: this run rewrites it from scratch.
	}
	const stillThere = await Promise.all(
		previous.map((sheet) =>
			stat(join(outDir, sheet.file)).then(
				() => sheet,
				() => null,
			),
		),
	);
	const byName = new Map(stillThere.filter(Boolean).map((sheet) => [sheet.name, sheet]));
	for (const sheet of downloaded) byName.set(sheet.name, sheet);

	const sheets = [...byName.values()];
	await writeFile(
		path,
		`${JSON.stringify({ fetchedAt: new Date().toISOString(), sheets }, null, '\t')}\n`,
		'utf8',
	);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const sheets = await discoverSheets();

	if (args.list) {
		for (const { gid, name } of sheets) console.log(`${gid.padStart(12)}  ${name}`);
		return;
	}

	let wanted = sheets;
	const asked = args.only ?? (args.all ? null : REQUIRED_SHEETS);
	if (asked) {
		wanted = sheets.filter((sheet) => asked.includes(sheet.name));
		const missing = asked.filter((name) => !sheets.some((sheet) => sheet.name === name));
		if (missing.length > 0) {
			throw new Error(
				`Not published (or misspelled): ${missing.join(', ')}. ` +
					`Run with --list to see what is available.`,
			);
		}
	}

	const outDir = resolve(ROOT, args.out);
	await mkdir(outDir, { recursive: true });

	const manifest = [];
	for (const { name, gid } of wanted) {
		const url = `${BASE}/pub?gid=${gid}&single=true&output=csv`;
		const csv = await fetchText(url, name);
		const fileName = toFileName(name);
		await writeFile(join(outDir, fileName), csv, 'utf8');

		const { rows, columns } = shapeOf(csv);
		manifest.push({ name, gid, file: fileName, rows, columns });
		console.log(`${name} -> ${args.out}/${fileName}  (${rows} rows x ${columns} cols)`);
	}

	await writeManifest(outDir, manifest);
	console.log(`\n${manifest.length} sheet(s) written to ${args.out}/`);
}

main().catch((error) => {
	console.error(`\n${error.message}`);
	process.exit(1);
});
