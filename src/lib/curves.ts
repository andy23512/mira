import curvesJson from '../../data/curves.json';

export interface Fit {
	/** The quantile this curve was fitted to, e.g. 0.5 for the median. */
	tau: number;
	a: number;
	b: number;
	pinballLoss: number;
}

export interface Series {
	name: string;
	n: number;
	sufficient: boolean;
	anchored: boolean;
	usable: boolean;
	daysRange: [number, number];
	/** The day by which 95% of this series' records were logged. */
	denseTo: number;
	wpmRange: [number, number];
	fits: Fit[];
	leastSquares: { a: number; b: number };
	crossings: { between: [number, number]; atDays: number }[];
}

export interface Curves {
	generatedAt: string;
	source: string;
	model: string;
	note: string;
	quantiles: number[];
	minPoints: number;
	maxStartDay: number;
	series: Series[];
}

export const curves = curvesJson as Curves;

/** The series a band can honestly be drawn from — see build-curves.mjs. */
export const usableSeries = curves.series.filter((series) => series.usable);

/**
 * Whether a day falls inside the stretch the curves were actually fitted over.
 * Past it there is no evidence at all, so no percentile can be named — a CC1 owner
 * four years in is beyond day 1078 and the model has nothing to say about them.
 */
export const isWithinFit = (series: Series, days: number) =>
	days >= series.daysRange[0] && days <= series.daysRange[1];

/** wpm = a * days^b */
export const wpmAt = (fit: Fit, days: number) => fit.a * days ** fit.b;

export const fitAt = (series: Series, tau: number) =>
	series.fits.find((fit) => fit.tau === tau);

/** A day is one plotted column; log spacing keeps the first weeks from collapsing. */
export function sampleDays(min: number, max: number, count = 160) {
	const step = (Math.log(max) - Math.log(min)) / (count - 1);
	return Array.from({ length: count }, (_, i) => Math.exp(Math.log(min) + i * step));
}

export interface CurveSample {
	days: number;
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
}

export function sampleSeries(series: Series, count?: number): CurveSample[] {
	const [min, max] = series.daysRange;
	return sampleDays(min, max, count).map((days) => {
		const at = (tau: number) => {
			const fit = fitAt(series, tau);
			return fit ? wpmAt(fit, days) : Number.NaN;
		};
		return { days, p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) };
	});
}

export interface Placement {
	/** Percentile in 0-100, or null when the point sits outside the fitted range. */
	percentile: number | null;
	/** Set when the point is below the lowest or above the highest fitted curve. */
	beyond: 'below' | 'above' | null;
	/** The curve values at that day, for the readout and the table. */
	at: Record<number, number>;
}

/**
 * Where a (days, wpm) point falls among the fitted curves.
 *
 * Interpolating in log(wpm) matches the space the curves were fitted in, so the
 * reading is consistent with the model rather than with the pixels. Outside the
 * p10-p90 span there is nothing to interpolate between, so the result is reported
 * as a bound rather than an invented number.
 */
export function placePoint(series: Series, days: number, wpm: number): Placement {
	const sorted = [...series.fits].sort((left, right) => left.tau - right.tau);
	const at: Record<number, number> = {};
	for (const fit of sorted) at[fit.tau] = wpmAt(fit, days);

	const first = sorted[0];
	const last = sorted.at(-1)!;
	if (wpm <= at[first.tau]) {
		return { percentile: null, beyond: 'below', at };
	}
	if (wpm >= at[last.tau]) {
		return { percentile: null, beyond: 'above', at };
	}

	for (let i = 1; i < sorted.length; i++) {
		const lower = sorted[i - 1];
		const upper = sorted[i];
		const lowWpm = at[lower.tau];
		const highWpm = at[upper.tau];
		if (wpm < lowWpm || wpm > highWpm) continue;
		const share = (Math.log(wpm) - Math.log(lowWpm)) / (Math.log(highWpm) - Math.log(lowWpm));
		const tau = lower.tau + share * (upper.tau - lower.tau);
		return { percentile: tau * 100, beyond: null, at };
	}

	return { percentile: null, beyond: null, at };
}

/** How many days of practice this series' median needs to reach a target speed. */
export function daysToReach(series: Series, tau: number, wpm: number) {
	const fit = fitAt(series, tau);
	if (!fit) return null;
	const days = (wpm / fit.a) ** (1 / fit.b);
	return Number.isFinite(days) && days > 0 ? days : null;
}
