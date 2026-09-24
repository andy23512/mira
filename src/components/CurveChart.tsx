import * as Plot from '@observablehq/plot';
import { useEffect, useRef, useState } from 'react';
import { isWithinFit, placePoint, sampleSeries, type Series } from '../lib/curves.ts';
import { rankLabel } from '../lib/format.ts';
import type { OwnPoint } from '../lib/records.ts';
import { SPEED_MILESTONES } from '../lib/speedMilestones.ts';
import { useChartTokens } from '../lib/tokens.ts';

/** Ticks a reader thinks in: a first week, a first month, then years. */
const DAY_TICKS = [1, 3, 7, 14, 30, 90, 180, 365, 730, 1095, 1825];

const WPM_TICKS = [5, 10, 20, 30, 50, 100, 200];

const SAMPLES = 160;
const HEIGHT = 420;

interface Props {
	series: Series;
	points: OwnPoint[];
	/** The series' raw (days, wpm) records, drawn as a scatter when non-empty. */
	records?: { days: number; wpm: number }[];
}

/** Tracks the container's width so the plot fills the card at any size. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
	const [width, setWidth] = useState(720);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			setWidth(Math.max(360, Math.round(entry.contentRect.width)));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

const fmt = (value: number) => value.toFixed(1);

export function CurveChart({ series, points, records = [] }: Props) {
	const host = useRef<HTMLDivElement>(null);
	const width = useWidth(host);
	const tokens = useChartTokens();

	useEffect(() => {
		const element = host.current;
		if (!element) return;

		const [minDays, maxDays] = series.daysRange;
		const logStep = (Math.log(maxDays) - Math.log(minDays)) / (SAMPLES - 1);
		const samples = sampleSeries(series, SAMPLES).map((sample) => {
			// A record is attached to the column it lands in, so the crosshair can
			// report "yours" alongside the percentiles instead of needing its own tip.
			const own = points.find(
				(point) => Math.abs(Math.log(point.days) - Math.log(sample.days)) <= logStep / 2,
			);
			return { ...sample, own: own?.wpm };
		});

		const last = samples.at(-1)!;
		const first = samples[0];
		// A power law on a linear axis spends most of its height on the last months
		// and squeezes the first weeks — where nearly every reader actually is — into
		// a sliver. Log-log straightens it out and makes the whole span readable.
		const ceiling = Math.max(last.p90, ...points.map((point) => point.wpm)) * 1.08;
		const floor = Math.min(first.p10, ...points.map((point) => point.wpm)) * 0.85;
		const xMin = Math.min(minDays, ...points.map((point) => point.days));
		const xMax = Math.max(maxDays, ...points.map((point) => point.days));
		const dayTicks = DAY_TICKS.filter((day) => day >= xMin && day <= xMax);
		const wpmTicks = WPM_TICKS.filter((wpm) => wpm >= floor && wpm <= ceiling);

		const title = (sample: (typeof samples)[number]) => {
			const lines = [
				`Day ${Math.round(sample.days)}`,
				`p90   ${fmt(sample.p90)} wpm`,
				`p75   ${fmt(sample.p75)} wpm`,
				`p50   ${fmt(sample.p50)} wpm`,
				`p25   ${fmt(sample.p25)} wpm`,
				`p10   ${fmt(sample.p10)} wpm`,
			];
			if (sample.own !== undefined && isWithinFit(series, sample.days)) {
				const placed = placePoint(series, sample.days, sample.own);
				const rank = placed.percentile !== null
					? `${rankLabel(placed)} percentile`
					: rankLabel(placed);
				lines.push('', `You   ${fmt(sample.own)} wpm · ${rank}`);
			}
			return lines.join('\n');
		};

		// Dashed to read as reference lines rather than more data, and kept to the
		// left edge so they don't fight the p10/p50/p90 labels sitting on the right.
		const milestoneMarks = SPEED_MILESTONES.filter(
			(milestone) => milestone.wpm >= floor && milestone.wpm <= ceiling,
		).flatMap((milestone) => {
			const stroke = tokens.milestoneColors[milestone.wpm];
			const at = [{ days: xMin, wpm: milestone.wpm }];
			return [
				Plot.ruleY([milestone.wpm], {
					stroke,
					strokeWidth: 1.5,
					strokeDasharray: '4,3',
					strokeOpacity: 0.9,
				}),
				Plot.text(at, {
					x: 'days',
					y: 'wpm',
					text: () => `${milestone.wpm} · ${milestone.label}`,
					dx: 6,
					dy: -6,
					textAnchor: 'start',
					fill: stroke,
					fontSize: 10,
					fontWeight: 600,
				}),
			];
		});

		const label = (y: 'p10' | 'p50' | 'p90') =>
			Plot.text([last], {
				x: 'days',
				y,
				text: () => y,
				dx: 7,
				textAnchor: 'start',
				fill: tokens.textSecondary,
				fontSize: 11,
			});

		// Drawn last of the data marks so the reader's own line sits above the bands,
		// with a surface ring where a dot overlaps them.
		const ownMarks =
			points.length === 0
				? []
				: [
						Plot.line(points, {
							x: 'days',
							y: 'wpm',
							stroke: tokens.accent,
							strokeWidth: 2,
							curve: 'monotone-x',
						}),
						Plot.dot(points, {
							x: 'days',
							y: 'wpm',
							r: 4.5,
							fill: tokens.accent,
							stroke: tokens.surface,
							strokeWidth: 2,
						}),
						Plot.text([points.at(-1)!], {
							x: 'days',
							y: 'wpm',
							text: () => 'You',
							dy: -14,
							fill: tokens.textPrimary,
							fontSize: 11,
							fontWeight: 600,
						}),
					];

		const plot = Plot.plot({
			width,
			height: HEIGHT,
			marginLeft: 56,
			marginRight: 46,
			marginTop: 30,
			marginBottom: 42,
			style: { background: 'transparent', color: tokens.textSecondary, fontSize: '12px' },
			// The domain stretches to hold the reader's records even when they run past
			// the fit; the bands stop where the fit stops, which is the honest picture.
			x: { type: 'log', domain: [xMin, xMax], axis: null },
			y: { type: 'log', domain: [floor, ceiling], axis: null },
			marks: [
				// Plot's own x axis thins labels closer together than its 80px tickSpacing,
				// which on a log scale blanked 3, 7, 30, 90, 365 and 730 — and neither
				// `text` nor `tickSpacing` overrode it. Drawing the ticks as plain marks
				// keeps every one of them labelled.
				// Gridlines are drawn from the same tick lists as the labels; the scale's own
				// log grid would add a minor line between every labelled one.
				Plot.gridX(dayTicks, { stroke: tokens.grid, strokeOpacity: 1 }),
				Plot.gridY(wpmTicks, { stroke: tokens.grid, strokeOpacity: 1 }),
				Plot.text(dayTicks, {
					x: (day: number) => day,
					text: (day: number) => String(day),
					frameAnchor: 'bottom',
					dy: 18,
					fill: tokens.textSecondary,
					fontSize: 11,
				}),
				Plot.text(['Days since the device arrived (log scale) →'], {
					frameAnchor: 'bottom',
					dy: 36,
					fill: tokens.textSecondary,
					fontSize: 11,
				}),
				Plot.axisY(wpmTicks, {
					text: (wpm: number) => String(wpm),
					label: '↑ Words per minute (log scale)',
					labelOffset: 46,
				}),
				Plot.areaY(samples, { x: 'days', y1: 'p10', y2: 'p90', fill: tokens.bandOuter }),
				Plot.areaY(samples, { x: 'days', y1: 'p25', y2: 'p75', fill: tokens.bandInner }),
				Plot.line(samples, { x: 'days', y: 'p50', stroke: tokens.bandMedian, strokeWidth: 2 }),
				// The bands are a fitted summary; the dots underneath are what they were
				// fitted to, so a reader can see where the evidence is thick or thin.
				...(records.length > 0
					? [
							Plot.dot(records, {
								x: 'days',
								y: 'wpm',
								r: 1.75,
								fill: tokens.textMuted,
								fillOpacity: 0.35,
								stroke: null,
							}),
						]
					: []),
				...(series.denseTo < maxDays * 0.95
					? [
							Plot.ruleX([series.denseTo], {
								stroke: tokens.textSecondary,
								strokeOpacity: 0.55,
							}),
							Plot.text([series.denseTo], {
								x: (day: number) => day,
								text: () => '← 95% of records',
								frameAnchor: 'top',
								dx: -6,
								dy: -14,
								textAnchor: 'end',
								fill: tokens.textSecondary,
								fontSize: 11,
							}),
						]
					: []),
				...milestoneMarks,
				label('p90'),
				label('p50'),
				label('p10'),
				...ownMarks,
				Plot.ruleX(
					samples,
					Plot.pointerX({ x: 'days', stroke: tokens.textSecondary, strokeOpacity: 0.45 }),
				),
				Plot.tip(
					samples,
					Plot.pointerX({
						x: 'days',
						y: 'p90',
						title,
						format: { x: null, y: null },
						fill: tokens.surface,
						stroke: tokens.grid,
						textPadding: 9,
						lineHeight: 1.3,
					}),
				),
			],
		});

		plot.setAttribute('role', 'img');
		plot.setAttribute(
			'aria-label',
			`Percentile learning curves for ${series.name}: words per minute against days of practice, ` +
				`from the 10th to the 90th percentile. The same values are in the table below. ` +
				`Dashed reference lines mark notable typing speeds, explained below the chart.` +
				(records.length > 0
					? ` The underlying ${records.length.toLocaleString()} records are also plotted as dots.`
					: ''),
		);
		element.replaceChildren(plot);
		return () => plot.remove();
	}, [series, points, records, width, tokens]);

	return <div className="plot" ref={host} />;
}
