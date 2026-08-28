/**
 * The reader's own practice log. It never leaves the browser: the spreadsheet
 * behind Mira carries no identity for anyone, and neither does this.
 */

export interface RawRecord {
	/** Stable across edits, so a removed row does not shuffle the ones below it. */
	id: string;
	/** ISO date, as an <input type="date"> gives it. */
	date: string;
	/** Words per minute, as typed. Kept as a string so a half-typed value survives. */
	wpm: string;
}

export const newRecord = (): RawRecord => ({ id: crypto.randomUUID(), date: '', wpm: '' });

export interface OwnRecords {
	/** The day the device arrived — day 0, the day before the first day of practice. */
	startDate: string;
	records: RawRecord[];
}

export interface OwnPoint {
	date: string;
	days: number;
	wpm: number;
}

const STORAGE_KEY = 'mira.own-records.v1';

export const emptyRecords = (): OwnRecords => ({ startDate: '', records: [newRecord()] });

export function loadRecords(): OwnRecords {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return emptyRecords();
		const parsed = JSON.parse(stored) as OwnRecords;
		if (typeof parsed?.startDate !== 'string' || !Array.isArray(parsed.records)) {
			return emptyRecords();
		}
		// Rows saved before ids existed are given one on the way in.
		return { ...parsed, records: parsed.records.map((row) => ({ ...newRecord(), ...row })) };
	} catch {
		return emptyRecords();
	}
}

export function saveRecords(value: OwnRecords) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// A private window with storage denied still works, it just forgets.
	}
}

const DAY_MS = 86_400_000;

/**
 * Turns the typed rows into plottable points.
 *
 * The spreadsheet counts the arrival day as day 0 and holds no 0-WPM row, so the
 * first day of practice is day 1. Anything on or before the start date has no
 * place on a log axis and is dropped rather than clamped.
 */
export function toPoints({ startDate, records }: OwnRecords): OwnPoint[] {
	const start = Date.parse(`${startDate}T00:00:00Z`);
	if (!Number.isFinite(start)) return [];

	const points: OwnPoint[] = [];
	for (const { date, wpm } of records) {
		const at = Date.parse(`${date}T00:00:00Z`);
		const speed = Number(wpm);
		if (!Number.isFinite(at) || !Number.isFinite(speed) || wpm.trim() === '') continue;
		const days = Math.round((at - start) / DAY_MS);
		if (days < 1 || speed <= 0) continue;
		points.push({ date, days, wpm: speed });
	}
	return points.sort((left, right) => left.days - right.days);
}
