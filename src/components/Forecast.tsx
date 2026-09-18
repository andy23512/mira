import { type Placement, type Series } from '../lib/curves.ts';
import { ordinal } from '../lib/format.ts';
import type { OwnPoint } from '../lib/records.ts';
import { SPEED_MILESTONES } from '../lib/speedMilestones.ts';

interface Props {
	series: Series;
	latest: OwnPoint;
	placed: Placement;
}

/** The fitted quantile nearest the reader's own percentile, to shape their pace forward. */
function nearestTau(series: Series, placed: Placement) {
	const target = placed.percentile !== null ? placed.percentile / 100 : placed.beyond === 'above' ? 1 : 0;
	return series.fits.reduce((closest, fit) =>
		Math.abs(fit.tau - target) < Math.abs(closest.tau - target) ? fit : closest,
	);
}

/**
 * Where the reader's own pace leads next: their latest record, carried forward at the
 * growth rate (the `b` exponent) of the fitted percentile nearest them — not that
 * curve itself, which may already sit above or below where they actually are. Only
 * milestones the model can still speak to, inside the days the curve was actually
 * fitted over, are named; further out there is nothing behind the number.
 */
export function Forecast({ series, latest, placed }: Props) {
	const tau = nearestTau(series, placed);
	const personalA = latest.wpm / latest.days ** tau.b;
	const daysToReach = (wpm: number) => (wpm / personalA) ** (1 / tau.b);

	const ahead = SPEED_MILESTONES.filter((milestone) => milestone.wpm > latest.wpm);
	if (ahead.length === 0) {
		return <p className="note">Your latest record already clears every milestone tracked here.</p>;
	}

	const reachable = ahead
		.map((milestone) => ({ milestone, days: daysToReach(milestone.wpm) }))
		.filter((entry) => entry.days <= series.daysRange[1]);

	if (reachable.length === 0) {
		return (
			<p className="note">
				Every milestone ahead of your pace falls past day {series.daysRange[1]}, where{' '}
				{series.name}'s curve is no longer fitted — there is nothing to name a day from.
			</p>
		);
	}

	return (
		<>
			<p className="note">
				Carrying your latest record forward at the growth rate of {series.name}'s{' '}
				{ordinal(tau.tau * 100)} percentile:
			</p>
			<div className="legend">
				{reachable.map(({ milestone, days }) => (
					<span className="legend-item" key={milestone.wpm}>
						<span
							className="swatch line"
							style={{ background: `var(--speed-${milestone.wpm})` }}
						/>
						{milestone.wpm} wpm ({milestone.label}) around day {Math.round(days)}
					</span>
				))}
			</div>
		</>
	);
}
