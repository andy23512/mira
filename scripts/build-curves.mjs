#!/usr/bin/env node
/**
 * Fits quantile regression curves to the (days elapsed, WPM) scatter of each
 * device and writes them to data/curves.json.
 *
 * Model, one fit per quantile tau:
 *
 *   log(wpm) = A + B * log(days)      i.e.   wpm = a * days^b,  a = exp(A)
 *
 * Quantiles survive monotone transforms, so the tau-quantile of log(wpm) really
 * is the log of the tau-quantile of wpm — fitting in log space and exponentiating
 * is exact here, in a way it would not be for a mean.
 *
 * Every record is one observation. The spreadsheet carries no identity for who
 * produced a record, by design, so these curves describe the distribution of
 * *records*, not of *people*: someone who logs daily counts more than someone who
 * logs twice. State that wherever the curves are shown.
 *
 * Usage:
 *   node scripts/build-curves.mjs
 *   node scripts/build-curves.mjs --in data/raw/"Processed Data.csv" --out data/curves.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

/** Below this, a fit is reported but marked unfit to draw a band from. */
const MIN_POINTS = 50;

/**
 * A series whose earliest record is already weeks in says nothing about where the
 * curve starts, so its exponent is fixed only by a short stretch of log(days) and
 * extrapolates back to day 1 as nonsense. The transfer series are the case in
 * point: their day counts are measured from the *previous* device's start date.
 */
const MAX_START_DAY = 14;

/** Exponent bracket for the outer search; real learning curves sit near 0.1-0.5. */
const B_BRACKET = [-5, 5];

function parseArgs(argv) {
	const args = { in: 'data/raw/Processed Data.csv', out: 'data/curves.json' };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--in') args.in = argv[++i];
		else if (arg.startsWith('--in=')) args.in = arg.slice(5);
		else if (arg === '--out') args.out = argv[++i];
		else if (arg.startsWith('--out=')) args.out = arg.slice(6);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

/** Minimal RFC 4180 reader — enough for the sheet exports, quoted fields included. */
function parseCsv(text) {
	const rows = [[]];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char !== '"') field += char;
			else if (text[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
		} else if (char === '"') quoted = true;
		else if (char === ',') {
			rows.at(-1).push(field);
			field = '';
		} else if (char === '\n') {
			rows.at(-1).push(field);
			field = '';
			rows.push([]);
		} else if (char !== '\r') field += char;
	}
	rows.at(-1).push(field);
	if (rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
	return rows;
}

/**
 * "Processed Data" is wide: a (Days Elapsed, WPM) column pair per series, with
 * the series name on row 1 above the left column of each pair. Pairs have
 * different lengths, so blanks are holes rather than an end-of-data marker.
 */
function readSeries(csv) {
	const rows = parseCsv(csv);
	const [names, , ...body] = rows;
	const series = [];
	for (let col = 0; col < names.length; col += 2) {
		const name = names[col].trim();
		if (!name) continue;
		const points = [];
		for (const row of body) {
			const days = Number(row[col]);
			const wpm = Number(row[col + 1]);
			if (!row[col]?.trim() || !row[col + 1]?.trim()) continue;
			if (!Number.isFinite(days) || !Number.isFinite(wpm)) continue;
			if (days <= 0 || wpm <= 0) continue; // log space needs both strictly positive
			points.push({ days, wpm });
		}
		if (points.length > 0) series.push({ name, points });
	}
	return series;
}

const pinball = (residual, tau) => (residual >= 0 ? tau * residual : (tau - 1) * residual);

/** The tau-quantile of a sample, by the "lower" convention used for pinball loss. */
function quantileOf(sorted, tau) {
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(tau * sorted.length) - 1));
	return sorted[index];
}

/**
 * Fits one quantile by exploiting the shape of the problem: for a fixed slope B
 * the optimal intercept is exactly the tau-quantile of the residuals, so only the
 * slope needs searching. That leaves a 1-D convex problem, handled by ternary
 * search — no gradients, no local minima.
 */
function fitQuantile(x, y, tau) {
	const lossAt = (b) => {
		const residuals = new Float64Array(x.length);
		for (let i = 0; i < x.length; i++) residuals[i] = y[i] - b * x[i];
		const sorted = Float64Array.prototype.slice.call(residuals).sort();
		const a = quantileOf(sorted, tau);
		let loss = 0;
		for (let i = 0; i < residuals.length; i++) loss += pinball(residuals[i] - a, tau);
		return { loss, a };
	};

	let [low, high] = B_BRACKET;
	for (let i = 0; i < 200 && high - low > 1e-12; i++) {
		const third = (high - low) / 3;
		const m1 = low + third;
		const m2 = high - third;
		if (lossAt(m1).loss <= lossAt(m2).loss) high = m2;
		else low = m1;
	}
	const b = (low + high) / 2;
	const { loss, a } = lossAt(b);
	return { b, A: a, loss };
}

/** Ordinary least squares in the same log space, for comparison against the fits. */
function fitLeastSquares(x, y) {
	const n = x.length;
	const meanX = x.reduce((sum, v) => sum + v, 0) / n;
	const meanY = y.reduce((sum, v) => sum + v, 0) / n;
	let sxy = 0;
	let sxx = 0;
	for (let i = 0; i < n; i++) {
		sxy += (x[i] - meanX) * (y[i] - meanY);
		sxx += (x[i] - meanX) ** 2;
	}
	const b = sxy / sxx;
	return { a: Math.exp(meanY - b * meanX), b };
}

/**
 * Separately fitted quantiles can cross, which would render as bands folding
 * through each other. Checked across the series' own day range.
 */
function findCrossings(fits, minDays, maxDays, samples = 400) {
	const crossings = [];
	const step = (Math.log(maxDays) - Math.log(minDays)) / (samples - 1);
	for (let i = 0; i < samples; i++) {
		const days = Math.exp(Math.log(minDays) + i * step);
		for (let j = 1; j < fits.length; j++) {
			const lower = fits[j - 1].a * days ** fits[j - 1].b;
			const upper = fits[j].a * days ** fits[j].b;
			if (upper < lower) {
				crossings.push({ between: [fits[j - 1].tau, fits[j].tau], atDays: Math.round(days) });
				break;
			}
		}
	}
	return crossings;
}

const round = (value, digits = 6) => Number(value.toFixed(digits));

/**
 * The day by which `share` of the records have been logged. The tail of a series
 * is thin — CC1 has six records past day 730 — and a band drawn there looks just
 * as solid as one drawn over eight hundred, so the chart needs to say where the
 * evidence runs out.
 */
function dayAtShare(days, share) {
	const sorted = [...days].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const csv = await readFile(resolve(ROOT, args.in), 'utf8');
	const series = readSeries(csv);

	const output = series.map(({ name, points }) => {
		const x = points.map((p) => Math.log(p.days));
		const y = points.map((p) => Math.log(p.wpm));
		const days = points.map((p) => p.days);
		const wpm = points.map((p) => p.wpm);

		const fits = QUANTILES.map((tau) => {
			const { A, b, loss } = fitQuantile(x, y, tau);
			return { tau, a: round(Math.exp(A)), b: round(b), pinballLoss: round(loss / x.length) };
		});

		const minDays = Math.min(...days);
		const maxDays = Math.max(...days);
		const ols = fitLeastSquares(x, y);

		const sufficient = points.length >= MIN_POINTS;
		const anchored = minDays <= MAX_START_DAY;

		return {
			name,
			n: points.length,
			sufficient,
			anchored,
			usable: sufficient && anchored,
			daysRange: [minDays, maxDays],
			denseTo: dayAtShare(days, 0.95),
			wpmRange: [Math.min(...wpm), Math.max(...wpm)],
			fits,
			leastSquares: { a: round(ols.a), b: round(ols.b) },
			crossings: findCrossings(fits, minDays, maxDays),
			// The raw (days, wpm) observations behind the fit, for an optional scatter
			// overlay — rounded, since the chart has no use for more precision than it shows.
			points: points.map((p) => ({ days: p.days, wpm: round(p.wpm, 1) })),
		};
	});

	const payload = {
		generatedAt: new Date().toISOString(),
		source: args.in,
		model: 'wpm = a * days^b, fitted per quantile by minimising pinball loss on log(wpm)',
		note: 'One record = one observation; the spreadsheet holds no user identity, so these describe the distribution of records, not of people.',
		quantiles: QUANTILES,
		minPoints: MIN_POINTS,
		maxStartDay: MAX_START_DAY,
		series: output,
	};

	await writeFile(resolve(ROOT, args.out), `${JSON.stringify(payload, null, '\t')}\n`, 'utf8');

	for (const s of output) {
		const reasons = [];
		if (!s.sufficient) reasons.push(`under ${MIN_POINTS} points`);
		if (!s.anchored) reasons.push(`starts at day ${s.daysRange[0]}, so day 1 is extrapolated`);
		const flag = reasons.length > 0 ? `  (not usable: ${reasons.join('; ')})` : '';
		console.log(`${s.name}  n=${s.n}  days ${s.daysRange[0]}..${s.daysRange[1]}${flag}`);
		for (const fit of s.fits) {
			console.log(`    p${String(fit.tau * 100).padStart(2)}   wpm = ${fit.a} * days^${fit.b}`);
		}
		console.log(`    OLS   wpm = ${s.leastSquares.a} * days^${s.leastSquares.b}`);
		if (s.crossings.length > 0) {
			console.log(`    !! quantile crossing at ${s.crossings.length} sampled day(s)`);
		}
	}
	console.log(`\nWritten to ${args.out}`);
}

main().catch((error) => {
	console.error(`\n${error.message}`);
	process.exit(1);
});
