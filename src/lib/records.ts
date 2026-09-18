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

function isRawRecordShape(value: unknown): value is Pick<RawRecord, 'date' | 'wpm'> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as RawRecord).date === 'string' &&
		typeof (value as RawRecord).wpm === 'string'
	);
}

/**
 * Parses a records export — from localStorage or a file the reader picked — into
 * `OwnRecords`, or `null` if it is not one. Rows saved before ids existed, or read
 * back from a file that never had them, are given one on the way in.
 */
export function parseRecords(raw: string): OwnRecords | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			typeof (parsed as OwnRecords).startDate !== 'string' ||
			!Array.isArray((parsed as OwnRecords).records) ||
			!(parsed as OwnRecords).records.every(isRawRecordShape)
		) {
			return null;
		}
		const { startDate, records } = parsed as OwnRecords;
		return { startDate, records: records.map((row) => ({ ...newRecord(), ...row })) };
	} catch {
		return null;
	}
}

export function loadRecords(): OwnRecords {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return emptyRecords();
		return parseRecords(stored) ?? emptyRecords();
	} catch {
		return emptyRecords();
	}
}

const PASTED_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses rows pasted from another tool — one `date,wpm` (or tab-separated) pair per
 * line. A line is skipped, not guessed at, unless its date is already `YYYY-MM-DD`
 * (what the date inputs produce) and its wpm is a positive number.
 */
export function parsePastedRows(text: string) {
	const rows: Pick<RawRecord, 'date' | 'wpm'>[] = [];
	let skipped = 0;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '') continue;

		const fields = (line.includes('\t') ? line.split('\t') : line.split(',')).map((field) =>
			field.trim(),
		);
		const [date, wpm] = fields;
		const speed = Number(wpm);
		if (fields.length !== 2 || !date || !PASTED_DATE.test(date) || !Number.isFinite(speed) || speed <= 0) {
			skipped++;
			continue;
		}
		rows.push({ date, wpm });
	}
	return { rows, skipped };
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
