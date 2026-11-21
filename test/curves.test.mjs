import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	curves,
	daysToReach,
	fitAt,
	isWithinFit,
	placePoint,
	sampleDays,
	sampleSeries,
	usableSeries,
	wpmAt,
} from '../src/lib/curves.ts';

const close = (actual, expected, eps = 1e-9) =>
	assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not within ${eps} of ${expected}`);

// Flat curves (b = 0) keep the expected numbers easy to work out by hand.
const flat = {
	name: 'flat',
	daysRange: [1, 100],
	fits: [
		{ tau: 0.5, a: 40, b: 0, pinballLoss: 0 },
		{ tau: 0.1, a: 10, b: 0, pinballLoss: 0 },
		{ tau: 0.9, a: 160, b: 0, pinballLoss: 0 },
		{ tau: 0.25, a: 20, b: 0, pinballLoss: 0 },
		{ tau: 0.75, a: 80, b: 0, pinballLoss: 0 },
	],
};

describe('wpmAt / fitAt', () => {
	it('is a * days^b', () => {
		assert.equal(wpmAt({ a: 2, b: 0.5 }, 16), 8);
		assert.equal(wpmAt({ a: 3, b: 0 }, 999), 3);
		assert.equal(wpmAt({ a: 5, b: 1 }, 7), 35);
	});

	it('finds the fit of a quantile, or nothing', () => {
		assert.equal(fitAt(flat, 0.5).a, 40);
		assert.equal(fitAt(flat, 0.3), undefined);
	});
});

describe('isWithinFit', () => {
	it('includes both ends of the fitted days, and nothing outside', () => {
		assert.equal(isWithinFit(flat, 1), true);
		assert.equal(isWithinFit(flat, 100), true);
		assert.equal(isWithinFit(flat, 50), true);
		assert.equal(isWithinFit(flat, 0.99), false);
		assert.equal(isWithinFit(flat, 101), false);
	});
});

describe('sampleDays', () => {
	it('is spaced evenly in log, from min to max', () => {
		const days = sampleDays(1, 100, 3);
		assert.equal(days.length, 3);
		close(days[0], 1);
		close(days[1], 10);
		close(days[2], 100);
	});

	it('gives 160 columns by default', () => {
		const days = sampleDays(1, 1000);
		assert.equal(days.length, 160);
		close(days[0], 1);
		close(days.at(-1), 1000, 1e-6);
	});
});

describe('sampleSeries', () => {
	it('reads each quantile at each sampled day', () => {
		const samples = sampleSeries(
			{
				daysRange: [1, 100],
				fits: [
					{ tau: 0.1, a: 1, b: 1 },
					{ tau: 0.25, a: 2, b: 1 },
					{ tau: 0.5, a: 3, b: 1 },
					{ tau: 0.75, a: 4, b: 1 },
					{ tau: 0.9, a: 5, b: 1 },
				],
			},
			3,
		);
		assert.equal(samples.length, 3);
		close(samples[1].days, 10);
		close(samples[1].p10, 10);
		close(samples[1].p25, 20);
		close(samples[1].p50, 30);
		close(samples[1].p75, 40);
		close(samples[1].p90, 50);
	});

	it('is NaN for a quantile the series has no fit for', () => {
		const [sample] = sampleSeries({ daysRange: [1, 10], fits: [{ tau: 0.5, a: 2, b: 0 }] }, 2);
		assert.equal(sample.p50, 2);
		assert.ok(Number.isNaN(sample.p10));
		assert.ok(Number.isNaN(sample.p90));
	});
});

describe('placePoint', () => {
	it('reports the curve value of every fit at that day, whatever the order of the fits', () => {
		const { at } = placePoint(flat, 5, 30);
		assert.deepEqual(at, { 0.1: 10, 0.25: 20, 0.5: 40, 0.75: 80, 0.9: 160 });
	});

	it('names an exact percentile when the point is on a curve', () => {
		const { percentile, beyond } = placePoint(flat, 5, 40);
		assert.equal(percentile, 50);
		assert.equal(beyond, null);
		assert.equal(placePoint(flat, 5, 20).percentile, 25);
		assert.equal(placePoint(flat, 5, 80).percentile, 75);
	});

	it('interpolates in log(wpm), not in wpm', () => {
		// halfway between p25 (20) and p50 (40) in log space is 20 * sqrt(2)
		close(placePoint(flat, 5, 20 * Math.SQRT2).percentile, 37.5, 1e-9);
		// halfway in plain wpm (30) would read lower than that
		assert.ok(placePoint(flat, 5, 30).percentile > 37.5);
	});

	it('only reports a bound at or beyond the outer curves', () => {
		assert.deepEqual(
			{ ...placePoint(flat, 5, 10), at: undefined },
			{ percentile: null, beyond: 'below', at: undefined },
		);
		assert.equal(placePoint(flat, 5, 9).beyond, 'below');
		assert.equal(placePoint(flat, 5, 160).beyond, 'above');
		assert.equal(placePoint(flat, 5, 1000).beyond, 'above');
		assert.equal(placePoint(flat, 5, 10.0001).beyond, null);
		assert.equal(placePoint(flat, 5, 159.99).beyond, null);
	});

	it('uses the curve value at the given day', () => {
		const rising = { fits: [{ tau: 0.1, a: 1, b: 1 }, { tau: 0.9, a: 3, b: 1 }] };
		// at day 10 the curves are 10 and 30: 20 is between them
		assert.equal(placePoint(rising, 10, 20).beyond, null);
		// at day 100 the curves are 100 and 300: 20 is below
		assert.equal(placePoint(rising, 100, 20).beyond, 'below');
	});

	it('does not change the order of the fits it was given', () => {
		const taus = flat.fits.map((fit) => fit.tau);
		placePoint(flat, 5, 30);
		assert.deepEqual(
			flat.fits.map((fit) => fit.tau),
			taus,
		);
	});
});

describe('daysToReach', () => {
	const series = { fits: [{ tau: 0.5, a: 2, b: 0.5, pinballLoss: 0 }] };

	it('inverts the curve', () => {
		// 8 = 2 * days^0.5 -> days = 16
		close(daysToReach(series, 0.5, 8), 16);
		close(wpmAt(series.fits[0], daysToReach(series, 0.5, 30)), 30, 1e-9);
	});

	it('is null without a fit for that quantile', () => {
		assert.equal(daysToReach(series, 0.9, 8), null);
	});

	it('is null when the curve never gets there', () => {
		// a flat curve has no day on which it reaches another speed
		assert.equal(daysToReach({ fits: [{ tau: 0.5, a: 5, b: 0 }] }, 0.5, 10), null);
	});

	it('is null for a speed that gives no positive day', () => {
		assert.equal(daysToReach(series, 0.5, 0), null);
		assert.equal(daysToReach(series, 0.5, -3), null);
	});
});

describe('the shipped curves', () => {
	it('keeps only series that are sufficient and anchored as usable', () => {
		assert.ok(curves.series.length > 0);
		for (const series of curves.series) {
			assert.equal(series.usable, series.sufficient && series.anchored, series.name);
			assert.equal(series.sufficient, series.n >= curves.minPoints, series.name);
			assert.equal(series.anchored, series.daysRange[0] <= curves.maxStartDay, series.name);
		}
		assert.deepEqual(
			usableSeries.map((s) => s.name),
			curves.series.filter((s) => s.usable).map((s) => s.name),
		);
		assert.ok(usableSeries.length >= 1);
	});

	it('has a fit for every quantile in each series, with increasing curves at day 1 to 30', () => {
		for (const series of curves.series) {
			assert.deepEqual(
				series.fits.map((f) => f.tau),
				curves.quantiles,
				series.name,
			);
		}
		for (const series of usableSeries) {
			for (const days of [1, 10, 30]) {
				const speeds = curves.quantiles.map((tau) => wpmAt(fitAt(series, tau), days));
				assert.deepEqual([...speeds].sort((l, r) => l - r), speeds, `${series.name} day ${days}`);
			}
		}
	});

	it('records as many points as it says', () => {
		for (const series of curves.series) assert.equal(series.points.length, series.n, series.name);
	});
});
