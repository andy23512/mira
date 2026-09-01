/**
 * Notable typing speeds from Tangent's Speed Achievement Stats
 * (https://andy23512.github.io/blog/tangent-s-unofficial-charachorder-and-forge-learning-progress-statistic/#Speed-Achievement-Stats),
 * drawn as reference lines on the curve chart.
 */
export interface SpeedMilestone {
	wpm: number;
	label: string;
	description: string;
}

export const SPEED_MILESTONES: SpeedMilestone[] = [
	{ wpm: 40, label: 'Average typist', description: 'The speed of an average typist.' },
	{ wpm: 60, label: 'Professional typist', description: 'The speed of a professional typist.' },
	{ wpm: 100, label: 'Top 1% typist', description: 'The speed of a top-1% typist.' },
	{
		wpm: 150,
		label: 'Speed of sound',
		description:
			'Average human conversational speed. Speeds above this are nicknamed "Supersonic".',
	},
	{
		wpm: 250,
		label: 'Speed of thought',
		description: 'Average human reading speed. Speeds above this are nicknamed "Hypercerebral".',
	},
];
