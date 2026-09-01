import { useEffect, useMemo, useState } from 'react';
import { CurveChart } from './components/CurveChart.tsx';
import { CurveTable } from './components/CurveTable.tsx';
import { RecordEditor } from './components/RecordEditor.tsx';
import { curves, isWithinFit, placePoint, usableSeries } from './lib/curves.ts';
import { rankLabel } from './lib/format.ts';
import { loadRecords, saveRecords, toPoints } from './lib/records.ts';
import { SPEED_MILESTONES } from './lib/speedMilestones.ts';

/** The combined series is not simply the three device series added together. */
const COMBINED = 'CC1 & CC2 & M4G';

export function App() {
	const [own, setOwn] = useState(loadRecords);
	const [seriesName, setSeriesName] = useState(usableSeries[0]?.name ?? '');

	useEffect(() => saveRecords(own), [own]);

	const series = usableSeries.find((candidate) => candidate.name === seriesName) ?? usableSeries[0];
	const points = useMemo(() => toPoints(own), [own]);

	const latest = points.at(-1);
	const placed =
		latest && isWithinFit(series, latest.days)
			? placePoint(series, latest.days, latest.wpm)
			: null;

	return (
		<div className="page">
			<header className="masthead">
				<h1>Mira</h1>
				<p>
					Where a CharaChorder typing speed sits among everyone else's, at the same point in
					their practice. Percentile learning curves fitted to{' '}
					{curves.series.find((s) => s.name === COMBINED)?.n.toLocaleString()} shared records.
				</p>
			</header>

			<div className="filters">
				<label className="field">
					<span>Device</span>
					<select value={series.name} onChange={(event) => setSeriesName(event.target.value)}>
						{usableSeries.map((candidate) => (
							<option key={candidate.name} value={candidate.name}>
								{candidate.name} ({candidate.n.toLocaleString()} records)
							</option>
						))}
					</select>
				</label>
				<p className="note">
					Days {series.daysRange[0]}–{series.daysRange[1]} were fitted; no band is drawn past
					them.
				</p>
			</div>

			{latest && !placed && (
				<div className="card">
					<p className="note">
						Your latest record lands on day {latest.days}, past day {series.daysRange[1]} —
						the last day {series.name} has any record for. There is nothing to compare it
						against, so no percentile is named for it here or in the table.
					</p>
				</div>
			)}

			{latest && placed && (
				<div className="card">
					<div className="readout">
						<div className="stat">
							<span className="stat-value">{rankLabel(placed)}</span>
							<span className="stat-label">
								your latest record on {series.name}, at day {latest.days}
							</span>
						</div>
						<div className="stat">
							<span className="stat-value">{latest.wpm.toFixed(1)}</span>
							<span className="stat-label">
								words per minute · median at day {latest.days} is {placed.at[0.5].toFixed(1)}
							</span>
						</div>
					</div>
				</div>
			)}

			<div className="card">
				<h2>{series.name} learning curve percentiles</h2>
				<CurveChart series={series} points={points} />
				<div className="legend">
					<span className="legend-item">
						<span className="swatch" style={{ background: 'var(--band-outer)' }} />
						10th–90th percentile
					</span>
					<span className="legend-item">
						<span className="swatch" style={{ background: 'var(--band-inner)' }} />
						25th–75th percentile
					</span>
					<span className="legend-item">
						<span className="swatch line" style={{ background: 'var(--band-median)' }} />
						Median (50th)
					</span>
					{points.length > 0 && (
						<span className="legend-item">
							<span className="swatch line" style={{ background: 'var(--accent)' }} />
							Your records
						</span>
					)}
				</div>
				<p className="note">
					Each curve is <code>wpm = a · days^b</code>, fitted to the {series.n.toLocaleString()}{' '}
					records for this device by minimising pinball loss on log(wpm) — a quantile
					regression, so the 90th-percentile curve really is the 90th percentile of records at
					every day, not a shifted average.
				</p>
				<div className="legend">
					{SPEED_MILESTONES.map((milestone) => (
						<span className="legend-item" key={milestone.wpm}>
							<span
								className="swatch line"
								style={{ background: `var(--speed-${milestone.wpm})` }}
							/>
							{milestone.wpm} wpm — {milestone.label}
						</span>
					))}
				</div>
				<p className="note">
					The dashed lines mark notable typing speeds from{' '}
					<a
						href="https://andy23512.github.io/blog/tangent-s-unofficial-charachorder-and-forge-learning-progress-statistic/#Speed-Achievement-Stats"
						target="_blank"
						rel="noopener"
					>
						Tangent's Speed Achievement Stats
					</a>
					: {SPEED_MILESTONES.map((milestone, i) => (
						<span key={milestone.wpm}>
							{i > 0 && '; '}
							{milestone.wpm} wpm is {milestone.description.charAt(0).toLowerCase()}
							{milestone.description.slice(1).replace(/\.$/, '')}
						</span>
					))}
					.
				</p>
			</div>

			<RecordEditor value={own} onChange={setOwn} />

			<div className="card">
				<h2>Table view</h2>
				<CurveTable series={series} points={points} />
			</div>

			<footer>
				<details>
					<summary>How to read this, and what it does not say</summary>
					<p className="note">
						One record counts as one observation. The source spreadsheet holds no identity for
						anyone who contributed, by design, so these curves describe the distribution of{' '}
						<em>records</em>, not of <em>people</em>: someone who logs their speed daily weighs
						more than someone who logs it twice.
					</p>
					<p className="note">
						The <code>{COMBINED}</code> series follows someone across a device change, so it
						takes in the two transfer datasets as well:{' '}
						{curves.series.find((s) => s.name === COMBINED)?.n.toLocaleString()} records, more
						than CC1, CC2 and M4G together. Each single-device series stops at the switch and
						counts nothing logged after it.
					</p>
					<p className="note">
						The tail of every series is thin — 95% of {series.name}'s records fall on or before
						day {series.denseTo}, out of a fitted range that runs to day {series.daysRange[1]}.
						The band past that mark is drawn from few records and reads far more confident than
						it is.
					</p>
					<p className="note">
						CCL, CCX and the two transfer series are left out: they have too few records, or
						they start weeks in, which leaves the exponent fixed by too short a stretch of the
						curve to extrapolate back to day 1.
					</p>
				</details>
				<p className="note">
					Curves generated {new Date(curves.generatedAt).toISOString().slice(0, 10)} from
					Tangent's Unofficial CharaChorder and Forge Learning Progress Statistic. Unofficial —
					not affiliated with CharaChorder.{' '}
					<a href="https://github.com/andy23512/mira" target="_blank" rel="noopener">
						Source on GitHub
					</a>.
				</p>
			</footer>
		</div>
	);
}
