import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
	MAX_START_DAY,
	MIN_POINTS,
	QUANTILES,
	dayAtShare,
	findCrossings,
	fitLeastSquares,
	fitQuantile,
	parseArgs,
	parseCsv,
	pinball,
	quantileOf,
	readSeries,
	round,
} from '../scripts/build-curves.mjs';
import * as fetchSheets from '../scripts/fetch-sheets.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const close = (actual, expected, eps = 1e-9) =>
	assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not within ${eps} of ${expected}`);

describe('build-curves: constants', () => {
	it('fits the five quantiles the chart draws', () => {
		assert.deepEqual(QUANTILES, [0.1, 0.25, 0.5, 0.75, 0.9]);
		assert.equal(MIN_POINTS, 50);
		assert.equal(MAX_START_DAY, 14);
	});
});

describe('build-curves: parseArgs', () => {
	it('has defaults', () => {
		assert.deepEqual(parseArgs([]), { in: 'data/raw/Processed Data.csv', out: 'data/curves.json' });
	});
	it('takes --in and --out, spaced or with =', () => {
		assert.deepEqual(parseArgs(['--in', 'a.csv', '--out', 'b.json']), { in: 'a.csv', out: 'b.json' });
		assert.deepEqual(parseArgs(['--in=a.csv', '--out=b.json']), { in: 'a.csv', out: 'b.json' });
	});
	it('refuses what it does not know', () => {
		assert.throws(() => parseArgs(['--nope']), /Unknown argument: --nope/);
		assert.throws(() => parseArgs(['stray']), /Unknown argument: stray/);
	});
});

describe('build-curves: parseCsv', () => {
	it('splits rows and fields', () => {
		assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
	});
	it('needs no newline at the end', () => {
		assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
	});
	it('reads Windows line ends', () => {
		assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
	});
	it('keeps empty fields', () => {
		assert.deepEqual(parseCsv('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']]);
	});
	it('reads quoted fields, with commas, quotes and line breaks inside', () => {
		assert.deepEqual(parseCsv('"a,b","say ""hi""","x\ny"\n1,2,3\n'), [
			['a,b', 'say "hi"', 'x\ny'],
			['1', '2', '3'],
		]);
	});
	it('is empty for empty text', () => {
		assert.deepEqual(parseCsv(''), []);
	});
	it('keeps a blank line in the middle as a row of one empty field', () => {
		assert.deepEqual(parseCsv('a\n\nb\n'), [['a'], [''], ['b']]);
	});
});

describe('build-curves: readSeries', () => {
	it('reads a (days, wpm) pair of columns for each series name on the first row', () => {
		const series = readSeries('A,,B,\nDays,WPM,Days,WPM\n1,10,2,20\n3,30,4,40\n');
		assert.deepEqual(series, [
			{ name: 'A', points: [{ days: 1, wpm: 10 }, { days: 3, wpm: 30 }] },
			{ name: 'B', points: [{ days: 2, wpm: 20 }, { days: 4, wpm: 40 }] },
		]);
	});
	it('treats a blank as a hole, not the end of the data', () => {
		const [a, b] = readSeries('A,,B,\nDays,WPM,Days,WPM\n1,10,,\n,,2,20\n3,30,4,40\n');
		assert.deepEqual(a.points, [{ days: 1, wpm: 10 }, { days: 3, wpm: 30 }]);
		assert.deepEqual(b.points, [{ days: 2, wpm: 20 }, { days: 4, wpm: 40 }]);
	});
	it('drops rows that are half empty, not numbers, or not above zero', () => {
		const [a] = readSeries('A,\nDays,WPM\n1,\n,5\nx,5\n5,y\n0,5\n5,0\n-1,5\n5,-1\n  ,  \n2,7\n');
		assert.deepEqual(a.points, [{ days: 2, wpm: 7 }]);
	});
	it('leaves out a series with no usable row, and a column pair with no name', () => {
		const series = readSeries('Empty,,Named,,\nDays,WPM,Days,WPM\n,,1,2\n');
		assert.deepEqual(series.map((s) => s.name), ['Named']);
		assert.equal(readSeries(',,\nDays,WPM\n1,2\n').length, 0);
	});
	it('trims names', () => {
		assert.equal(readSeries('  CC1  ,\nDays,WPM\n1,2\n')[0].name, 'CC1');
	});
});

describe('build-curves: small helpers', () => {
	it('pinball loss weighs misses on the two sides by tau', () => {
		assert.equal(pinball(2, 0.9), 1.8);
		close(pinball(-2, 0.9), 0.2);
		assert.equal(pinball(0, 0.3), 0);
		assert.equal(pinball(-4, 0.5), 2);
	});
	it('rounds to six digits unless told otherwise', () => {
		assert.equal(round(1.23456789), 1.234568);
		assert.equal(round(1.25, 1), 1.3);
		assert.equal(round(7, 3), 7);
	});
	it('quantileOf takes the lower-convention element', () => {
		const sorted = [1, 2, 3, 4, 5];
		assert.equal(quantileOf(sorted, 0.5), 3);
		assert.equal(quantileOf(sorted, 0.1), 1);
		assert.equal(quantileOf(sorted, 0.2), 1);
		assert.equal(quantileOf(sorted, 0.21), 2);
		assert.equal(quantileOf(sorted, 0.9), 5);
		assert.equal(quantileOf(sorted, 1), 5);
		assert.equal(quantileOf(sorted, 0), 1);
		assert.equal(quantileOf([7, 9], 0.5), 7);
	});
	it('dayAtShare is the day by which that share of the records is in', () => {
		const days = [5, 1, 3, 2, 4];
		assert.equal(dayAtShare(days, 0.95), 5);
		assert.equal(dayAtShare(days, 0.5), 3);
		assert.equal(dayAtShare(days, 0.2), 1);
		assert.equal(dayAtShare(days, 0.6), 3);
		assert.deepEqual(days, [5, 1, 3, 2, 4]); // the input is not sorted in place
	});
});

describe('build-curves: fitLeastSquares', () => {
	it('recovers an exact line', () => {
		const { a, b } = fitLeastSquares([0, 1, 2, 3], [1, 3, 5, 7]);
		close(b, 2);
		close(a, Math.E);
	});
	it('fits the mean line to scattered points', () => {
		const { a, b } = fitLeastSquares([0, 1, 2], [0, 1, 1]);
		close(b, 0.5);
		close(a, Math.exp(1 / 6));
	});
});

describe('build-curves: fitQuantile', () => {
	it('recovers an exact line for any quantile', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((v) => 2 * v + 1);
		for (const tau of QUANTILES) {
			const { b, A, loss } = fitQuantile(x, y, tau);
			close(b, 2, 1e-6);
			close(A, 1, 1e-6);
			close(loss, 0, 1e-6);
		}
	});
	it('ignores one wild point at the median, which the mean would not', () => {
		const x = [0, 1, 2, 3, 4];
		const y = [0, 1, 2, 3, 10];
		const median = fitQuantile(x, y, 0.5);
		close(median.b, 1, 1e-3);
		close(median.A, 0, 1e-3);
		assert.ok(fitLeastSquares(x, y).b > 1.5);
	});
	it('puts a higher quantile higher', () => {
		const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const y = [1, 3, 2, 5, 4, 7, 5, 9, 6, 8];
		const at = (tau) => {
			const { b, A } = fitQuantile(x, y, tau);
			return A + b * 4.5;
		};
		assert.ok(at(0.1) < at(0.5));
		assert.ok(at(0.5) < at(0.9));
	});
	it('reports the loss of the fit it chose', () => {
		const { loss } = fitQuantile([0, 1, 2, 3, 4], [0, 1, 2, 3, 10], 0.5);
		close(loss, 3, 1e-3);
	});
});

describe('build-curves: findCrossings', () => {
	it('finds nothing when the curves stay in order', () => {
		const fits = [{ tau: 0.1, a: 1, b: 1 }, { tau: 0.9, a: 2, b: 1 }];
		assert.deepEqual(findCrossings(fits, 1, 100), []);
	});
	it('finds every sampled day when the curves are swapped', () => {
		const fits = [{ tau: 0.1, a: 10, b: 0 }, { tau: 0.5, a: 5, b: 0 }];
		const found = findCrossings(fits, 1, 100);
		assert.equal(found.length, 400);
		assert.deepEqual(found[0], { between: [0.1, 0.5], atDays: 1 });
		assert.equal(found.at(-1).atDays, 100);
	});
	it('finds the days where curves cross over, not before', () => {
		const fits = [{ tau: 0.1, a: 1, b: 1 }, { tau: 0.5, a: 10, b: 0 }];
		const found = findCrossings(fits, 1, 100);
		assert.ok(found.length > 0 && found.length < 400);
		assert.ok(found.every((c) => c.atDays >= 10));
	});
	it('names the pair that crossed', () => {
		const fits = [
			{ tau: 0.1, a: 1, b: 0 },
			{ tau: 0.5, a: 2, b: 0 },
			{ tau: 0.9, a: 1.5, b: 0 },
		];
		assert.ok(findCrossings(fits, 1, 10).every((c) => c.between[0] === 0.5 && c.between[1] === 0.9));
	});
});

describe('build-curves: the script', () => {
	let dir;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'mira-test-'));
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	const script = (...args) => run(process.execPath, [join(ROOT, 'scripts/build-curves.mjs'), ...args]);

	it('fits a series that follows wpm = 2 * days^0.5 and says it is usable', async () => {
		const rows = ['Synthetic,', 'Days,WPM'];
		for (let d = 1; d <= 60; d++) rows.push(`${d},${(2 * d ** 0.5).toFixed(6)}`);
		await writeFile(join(dir, 'in.csv'), `${rows.join('\n')}\n`);
		const { stdout } = await script('--in', join(dir, 'in.csv'), '--out', join(dir, 'out.json'));
		const out = JSON.parse(await readFile(join(dir, 'out.json'), 'utf8'));
		assert.deepEqual(out.quantiles, QUANTILES);
		assert.equal(out.series.length, 1);
		const [s] = out.series;
		assert.equal(s.name, 'Synthetic');
		assert.equal(s.n, 60);
		assert.equal(s.usable, true);
		assert.deepEqual(s.daysRange, [1, 60]);
		assert.equal(s.denseTo, 57);
		for (const fit of s.fits) {
			close(fit.a, 2, 1e-3);
			close(fit.b, 0.5, 1e-3);
		}
		close(s.leastSquares.b, 0.5, 1e-5);
		assert.deepEqual(s.crossings, []);
		assert.equal(s.points.length, 60);
		assert.match(stdout, /Synthetic {2}n=60 {2}days 1\.\.60/);
	});

	it('marks a short series, and one that starts late, as not usable', async () => {
		const rows = ['Short,,Late,', 'Days,WPM,Days,WPM'];
		for (let d = 1; d <= 10; d++) rows.push(`${d},${d + 5},${d + 20},${d + 5}`);
		for (let d = 11; d <= 60; d++) rows.push(`,,${d + 20},${d + 5}`);
		await writeFile(join(dir, 'in.csv'), `${rows.join('\n')}\n`);
		const { stdout } = await script('--in', join(dir, 'in.csv'), '--out', join(dir, 'out.json'));
		const out = JSON.parse(await readFile(join(dir, 'out.json'), 'utf8'));
		const [shortSeries, late] = out.series;
		assert.deepEqual([shortSeries.sufficient, shortSeries.anchored, shortSeries.usable], [false, true, false]);
		assert.deepEqual([late.sufficient, late.anchored, late.usable], [true, false, false]);
		assert.match(stdout, /under 50 points/);
		assert.match(stdout, /starts at day 21, so day 1 is extrapolated/);
	});

	it('counts exactly 50 points as enough, and a first record on day 14 as anchored', async () => {
		const rows = ['Edge,,Late,', 'Days,WPM,Days,WPM'];
		for (let i = 0; i < 50; i++) rows.push(`${14 + i},${10 + i},${15 + i},${10 + i}`);
		await writeFile(join(dir, 'in.csv'), `${rows.join('\n')}\n`);
		await script('--in', join(dir, 'in.csv'), '--out', join(dir, 'out.json'));
		const [edge, late] = JSON.parse(await readFile(join(dir, 'out.json'), 'utf8')).series;
		assert.deepEqual([edge.n, edge.sufficient, edge.anchored, edge.usable], [50, true, true, true]);
		assert.deepEqual([late.n, late.sufficient, late.anchored, late.usable], [50, true, false, false]);
	});

	it('fails with a message on an unknown argument or a missing file', async () => {
		await assert.rejects(script('--bogus'), (e) => e.code === 1 && /Unknown argument: --bogus/.test(e.stderr));
		await assert.rejects(script('--in', join(dir, 'missing.csv'), '--out', join(dir, 'o.json')), (e) => e.code === 1);
	});

	it('does not run when imported', async () => {
		// importing at the top of this file already did that without touching data/curves.json
		const before = await readFile(join(ROOT, 'data/curves.json'), 'utf8');
		await import('../scripts/build-curves.mjs');
		assert.equal(await readFile(join(ROOT, 'data/curves.json'), 'utf8'), before);
	});

	it('regenerates the committed curves.json from the committed CSV, apart from the time stamp', async () => {
		await script('--out', join(dir, 'out.json'));
		const fresh = JSON.parse(await readFile(join(dir, 'out.json'), 'utf8'));
		const committed = JSON.parse(await readFile(join(ROOT, 'data/curves.json'), 'utf8'));
		delete fresh.generatedAt;
		delete committed.generatedAt;
		assert.deepEqual(fresh, committed);
	});
});

describe('fetch-sheets: small helpers', () => {
	it('splitNames trims, drops blanks, and copes with nothing', () => {
		assert.deepEqual(fetchSheets.splitNames('a, b,,c ,'), ['a', 'b', 'c']);
		assert.deepEqual(fetchSheets.splitNames(undefined), []);
		assert.deepEqual(fetchSheets.splitNames(null), []);
		assert.deepEqual(fetchSheets.splitNames('Processed Data'), ['Processed Data']);
	});

	it('parseArgs has defaults and reads every flag', () => {
		assert.deepEqual(fetchSheets.parseArgs([]), { list: false, all: false, only: null, out: 'data/raw' });
		assert.deepEqual(fetchSheets.parseArgs(['--list', '--all']), {
			list: true,
			all: true,
			only: null,
			out: 'data/raw',
		});
		assert.deepEqual(fetchSheets.parseArgs(['--only', 'A,B', '--out', 'x']).only, ['A', 'B']);
		assert.deepEqual(fetchSheets.parseArgs(['--only=A, B', '--out=y']), {
			list: false,
			all: false,
			only: ['A', 'B'],
			out: 'y',
		});
		assert.throws(() => fetchSheets.parseArgs(['--what']), /Unknown argument: --what/);
	});

	it('parseArgs: --only with no names is an error, not an empty selection', () => {
		const message = /--only needs at least one sheet name/;
		assert.throws(() => fetchSheets.parseArgs(['--only']), message);
		assert.throws(() => fetchSheets.parseArgs(['--only=']), message);
		assert.throws(() => fetchSheets.parseArgs(['--only', ' , ']), message);
	});

	it('decodeName reads the escapes the published page uses', () => {
		assert.equal(fetchSheets.decodeName('Processed\\x20Data'), 'Processed Data');
		assert.equal(fetchSheets.decodeName('A\\x22B'), 'A"B');
		assert.equal(fetchSheets.decodeName('\\u5b78\\u7fd2'), '學習');
		assert.equal(fetchSheets.decodeName('a\\/b'), 'a/b');
		assert.equal(fetchSheets.decodeName('plain'), 'plain');
		assert.equal(fetchSheets.decodeName('\\X41'), 'A');
	});

	it('toFileName keeps CJK, strips what a file system would object to, and adds .csv', () => {
		assert.equal(fetchSheets.toFileName('Processed Data'), 'Processed Data.csv');
		assert.equal(fetchSheets.toFileName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j.csv');
		assert.equal(fetchSheets.toFileName('  學習  '), '學習.csv');
	});

	it('shapeOf counts rows and the columns of the first row', () => {
		assert.deepEqual(fetchSheets.shapeOf('a,b,c\n1,2,3\n'), { rows: 2, columns: 3 });
		assert.deepEqual(fetchSheets.shapeOf('a,b\r\n1,2\r\n3,4'), { rows: 3, columns: 2 });
		assert.deepEqual(fetchSheets.shapeOf(''), { rows: 1, columns: 0 });
	});
});

describe('fetch-sheets: network', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	const respond = (body, status = 200) => async () => new Response(body, { status });

	it('fetchText returns the CSV body', async () => {
		globalThis.fetch = respond('a,b\n1,2\n');
		assert.equal(await fetchSheets.fetchText('https://x', 'Sheet'), 'a,b\n1,2\n');
	});

	it('fetchText says the sheet is probably not published on an error status', async () => {
		globalThis.fetch = respond('nope', 404);
		await assert.rejects(fetchSheets.fetchText('https://x', 'Sheet'), /Sheet: HTTP 404.*not published/);
	});

	it('fetchText notices a sign-in page served with status 200', async () => {
		for (const html of ['<!DOCTYPE html><html>', '  <html lang="en">', '<HTML>']) {
			globalThis.fetch = respond(html);
			await assert.rejects(fetchSheets.fetchText('https://x', 'Sheet'), /got an HTML page where CSV was expected/);
		}
	});

	it('fetchText lets a CSV through that merely mentions html later', async () => {
		globalThis.fetch = respond('a,<html>\n1,2\n');
		assert.equal(await fetchSheets.fetchText('https://x', 'S'), 'a,<html>\n1,2\n');
	});

	it('discoverSheets reads the name and gid of each published sheet', async () => {
		globalThis.fetch = respond(
			[
				'<script>',
				'items.push({name: "Processed\\x20Data", pageUrl: "https://x/pubhtml?gid=1", gid: "1436229425", initialSheet: true});',
				'items.push({name: "\\u5b78\\u7fd2", pageUrl: "p", gid: "42"});',
				'</script>',
			].join('\n'),
		);
		assert.deepEqual(await fetchSheets.discoverSheets(), [
			{ name: 'Processed Data', gid: '1436229425' },
			{ name: '學習', gid: '42' },
		]);
	});

	it('discoverSheets asks the published view of the sheet', async () => {
		let asked;
		globalThis.fetch = async (url) => {
			asked = String(url);
			return new Response('items.push({name: "A", gid: "1"});');
		};
		await fetchSheets.discoverSheets();
		assert.match(asked, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/2PACX-.*\/pubhtml$/);
	});

	it('discoverSheets complains when the view cannot be loaded or lists nothing', async () => {
		globalThis.fetch = respond('', 500);
		await assert.rejects(fetchSheets.discoverSheets(), /Could not load the published view \(HTTP 500\)/);
		globalThis.fetch = respond('<html>no scripts</html>');
		await assert.rejects(fetchSheets.discoverSheets(), /listed no sheets/);
	});
});

describe('fetch-sheets: writeManifest', () => {
	let dir;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'mira-manifest-'));
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	const read = async () => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
	const sheet = (name, rows = 1) => ({ name, gid: '1', file: `${name}.csv`, rows, columns: 2 });

	it('writes what was downloaded, with the time', async () => {
		await fetchSheets.writeManifest(dir, [sheet('A')]);
		const manifest = await read();
		assert.deepEqual(manifest.sheets, [sheet('A')]);
		assert.ok(!Number.isNaN(Date.parse(manifest.fetchedAt)));
	});

	it('keeps entries for sheets this run skipped, while their file is still there', async () => {
		await writeFile(join(dir, 'A.csv'), 'x');
		await fetchSheets.writeManifest(dir, [sheet('A')]);
		await fetchSheets.writeManifest(dir, [sheet('B')]);
		assert.deepEqual((await read()).sheets.map((s) => s.name), ['A', 'B']);
	});

	it('drops an entry whose file is gone', async () => {
		await fetchSheets.writeManifest(dir, [sheet('A')]); // A.csv was never written
		await fetchSheets.writeManifest(dir, [sheet('B')]);
		assert.deepEqual((await read()).sheets.map((s) => s.name), ['B']);
	});

	it('replaces the entry of a sheet downloaded again', async () => {
		await writeFile(join(dir, 'A.csv'), 'x');
		await fetchSheets.writeManifest(dir, [sheet('A', 1)]);
		await fetchSheets.writeManifest(dir, [sheet('A', 99)]);
		const { sheets } = await read();
		assert.equal(sheets.length, 1);
		assert.equal(sheets[0].rows, 99);
	});

	it('starts over from an unreadable manifest', async () => {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'manifest.json'), '{{{');
		await fetchSheets.writeManifest(dir, [sheet('A')]);
		assert.deepEqual((await read()).sheets.map((s) => s.name), ['A']);
	});
});
