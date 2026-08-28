import type { Placement } from './curves.ts';

/** 1st, 2nd, 3rd, 4th … 11th, 21st. */
export function ordinal(value: number) {
	const rounded = Math.round(value);
	const teen = rounded % 100 >= 11 && rounded % 100 <= 13;
	const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][rounded % 10] ?? 'th');
	return `${rounded}${suffix}`;
}

/** Outside the fitted p10-p90 span there is no percentile to name, only a bound. */
export function rankLabel(placed: Placement) {
	if (placed.percentile !== null) return ordinal(placed.percentile);
	if (placed.beyond === 'above') return 'above p90';
	if (placed.beyond === 'below') return 'below p10';
	return '—';
}
