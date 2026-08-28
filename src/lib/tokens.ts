import { useEffect, useState } from 'react';

/** The colour tokens a chart needs, read from CSS so dark mode stays in one place. */
export interface ChartTokens {
	bandOuter: string;
	bandInner: string;
	bandMedian: string;
	accent: string;
	surface: string;
	grid: string;
	textPrimary: string;
	textSecondary: string;
}

const read = (): ChartTokens => {
	const style = getComputedStyle(document.documentElement);
	const token = (name: string) => style.getPropertyValue(name).trim();
	return {
		bandOuter: token('--band-outer'),
		bandInner: token('--band-inner'),
		bandMedian: token('--band-median'),
		accent: token('--accent'),
		surface: token('--surface-2'),
		grid: token('--grid'),
		textPrimary: token('--text-primary'),
		textSecondary: token('--text-secondary'),
	};
};

/** Re-reads the tokens when the colour scheme changes, so the plot follows it. */
export function useChartTokens(): ChartTokens {
	const [tokens, setTokens] = useState(read);

	useEffect(() => {
		const query = matchMedia('(prefers-color-scheme: dark)');
		const update = () => setTokens(read());
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	}, []);

	return tokens;
}
