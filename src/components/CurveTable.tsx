import { isWithinFit, placePoint, wpmAt, type Series } from '../lib/curves.ts';
import { rankLabel } from '../lib/format.ts';
import type { OwnPoint } from '../lib/records.ts';

const MILESTONES = [1, 7, 14, 30, 60, 90, 180, 365, 730, 1095];

const fmt = (value: number) => value.toFixed(1);

interface Props {
	series: Series;
	points: OwnPoint[];
}

/** The WCAG-clean twin of the chart: every plotted value, readable without colour. */
export function CurveTable({ series, points }: Props) {
	const [minDays, maxDays] = series.daysRange;
	const days = MILESTONES.filter((day) => day >= minDays && day <= maxDays);
	const fits = [...series.fits].sort((left, right) => left.tau - right.tau);

	return (
		<table>
			<caption>
				Fitted words per minute for {series.name} at each percentile. Days outside{' '}
				{minDays}–{maxDays} are left out because the curves were not fitted there.
			</caption>
			<thead>
				<tr>
					<th scope="col">Day</th>
					{fits.map((fit) => (
						<th key={fit.tau} scope="col">
							p{fit.tau * 100}
						</th>
					))}
					<th scope="col">Yours</th>
					<th scope="col">Your percentile</th>
				</tr>
			</thead>
			<tbody>
				{days.map((day) => (
					<tr key={day}>
						<th scope="row">{day}</th>
						{fits.map((fit) => (
							<td key={fit.tau}>{fmt(wpmAt(fit, day))}</td>
						))}
						<td>—</td>
						<td>—</td>
					</tr>
				))}
				{points.map((point) => {
					const fitted = isWithinFit(series, point.days);
					return (
						<tr className="you-row" key={`${point.date}-${point.days}`}>
							<th scope="row">{point.days} (you)</th>
							{fits.map((fit) => (
								<td key={fit.tau}>{fitted ? fmt(wpmAt(fit, point.days)) : '—'}</td>
							))}
							<td>{fmt(point.wpm)}</td>
							<td>
								{fitted
									? rankLabel(placePoint(series, point.days, point.wpm))
									: 'outside the fit'}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
