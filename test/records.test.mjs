import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
	emptyRecords,
	loadRecords,
	newRecord,
	parsePastedRows,
	parseRecords,
	saveRecords,
	toPoints,
} from '../src/lib/records.ts';

function stubStorage(initial = {}) {
	const data = new Map(Object.entries(initial));
	const storage = {
		getItem: (key) => (data.has(key) ? data.get(key) : null),
		setItem: (key, value) => void data.set(key, String(value)),
		data,
	};
	Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
	return storage;
}

const KEY = 'mira.own-records.v1';

describe('newRecord / emptyRecords', () => {
	it('makes a blank row with its own id each time', () => {
		const a = newRecord();
		const b = newRecord();
		assert.equal(a.date, '');
		assert.equal(a.wpm, '');
		assert.match(a.id, /^[0-9a-f-]{36}$/);
		assert.notEqual(a.id, b.id);
	});

	it('starts with no date and one blank row', () => {
		const empty = emptyRecords();
		assert.equal(empty.startDate, '');
		assert.equal(empty.records.length, 1);
		assert.equal(empty.records[0].wpm, '');
	});
});

describe('parseRecords', () => {
	it('reads a records export, keeping an id that is there', () => {
		const parsed = parseRecords(
			JSON.stringify({ startDate: '2024-01-01', records: [{ id: 'keep', date: '2024-01-02', wpm: '20' }] }),
		);
		assert.deepEqual(parsed, {
			startDate: '2024-01-01',
			records: [{ id: 'keep', date: '2024-01-02', wpm: '20' }],
		});
	});

	it('gives rows without an id one, and different ones', () => {
		const { records } = parseRecords(
			JSON.stringify({
				startDate: '',
				records: [
					{ date: 'a', wpm: '1' },
					{ date: 'b', wpm: '2' },
				],
			}),
		);
		assert.equal(records.length, 2);
		assert.ok(records[0].id && records[1].id);
		assert.notEqual(records[0].id, records[1].id);
		assert.deepEqual(
			records.map(({ date, wpm }) => [date, wpm]),
			[
				['a', '1'],
				['b', '2'],
			],
		);
	});

	it('takes an empty list', () => {
		assert.deepEqual(parseRecords('{"startDate":"x","records":[]}'), { startDate: 'x', records: [] });
	});

	for (const [name, raw] of [
		['not JSON', 'nope'],
		['empty text', ''],
		['null', 'null'],
		['a number', '3'],
		['an array', '[]'],
		['no start date', '{"records":[]}'],
		['a start date that is not text', '{"startDate":1,"records":[]}'],
		['records that are not a list', '{"startDate":"","records":{}}'],
		['a row that is not an object', '{"startDate":"","records":[1]}'],
		['a null row', '{"startDate":"","records":[null]}'],
		['a speed that is a number', '{"startDate":"","records":[{"date":"a","wpm":20}]}'],
		['a row without a date', '{"startDate":"","records":[{"wpm":"20"}]}'],
	]) {
		it(`refuses ${name}`, () => assert.equal(parseRecords(raw), null));
	}

	it('refuses the whole file when one row is bad', () => {
		const raw = JSON.stringify({
			startDate: '',
			records: [{ date: 'a', wpm: '1' }, { date: 'b', wpm: 2 }],
		});
		assert.equal(parseRecords(raw), null);
	});
});

describe('loadRecords / saveRecords', () => {
	beforeEach(() => stubStorage());
	afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'));

	it('starts empty when nothing is saved', () => {
		const loaded = loadRecords();
		assert.equal(loaded.startDate, '');
		assert.equal(loaded.records.length, 1);
	});

	it('gives back what was saved', () => {
		const value = { startDate: '2024-01-01', records: [{ id: 'a', date: '2024-02-01', wpm: '33' }] };
		saveRecords(value);
		assert.deepEqual(loadRecords(), value);
	});

	it('saves under one versioned key', () => {
		const storage = stubStorage();
		saveRecords({ startDate: 's', records: [] });
		assert.deepEqual([...storage.data.keys()], [KEY]);
		assert.deepEqual(JSON.parse(storage.data.get(KEY)), { startDate: 's', records: [] });
	});

	it('starts empty when the saved text is damaged or of another shape', () => {
		for (const bad of ['{{{', '{"startDate":1}', '""']) {
			stubStorage({ [KEY]: bad });
			assert.equal(loadRecords().records.length, 1);
			assert.equal(loadRecords().startDate, '');
		}
	});

	it('starts empty when reading storage throws', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem() {
					throw new Error('denied');
				},
			},
			configurable: true,
		});
		assert.equal(loadRecords().startDate, '');
	});

	it('forgets quietly when writing storage throws', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				setItem() {
					throw new Error('denied');
				},
			},
			configurable: true,
		});
		assert.doesNotThrow(() => saveRecords({ startDate: '', records: [] }));
	});
});

describe('parsePastedRows', () => {
	it('reads comma and tab separated pairs, and trims them', () => {
		const { rows, skipped } = parsePastedRows('2024-01-02,30\n2024-01-03\t35.5\n  2024-01-04 , 40  ');
		assert.deepEqual(rows, [
			{ date: '2024-01-02', wpm: '30' },
			{ date: '2024-01-03', wpm: '35.5' },
			{ date: '2024-01-04', wpm: '40' },
		]);
		assert.equal(skipped, 0);
	});

	it('copes with Windows line ends and ignores blank lines without counting them', () => {
		const { rows, skipped } = parsePastedRows('2024-01-02,30\r\n\r\n   \r\n2024-01-03,31\r\n');
		assert.equal(rows.length, 2);
		assert.equal(skipped, 0);
	});

	it('skips, and counts, lines it cannot be sure about', () => {
		const { rows, skipped } = parsePastedRows(
			[
				'2024-1-2,30', // date not zero padded
				'01/02/2024,30', // another date format
				'2024-01-02,0', // no speed
				'2024-01-02,-5',
				'2024-01-02,fast',
				'2024-01-02,', // missing speed
				'2024-01-02', // one field
				'2024-01-02,30,extra', // three fields
				',30', // no date
				'2024-13-45,30', // not a calendar day
				'2023-02-30,30', // February has no 30th
				'2023-02-29,30', // not a leap year
				'2024-01-02,30', // the only good one
			].join('\n'),
		);
		assert.deepEqual(rows, [{ date: '2024-01-02', wpm: '30' }]);
		assert.equal(skipped, 12);
	});

	it('accepts real edge days such as a leap day', () => {
		assert.deepEqual(parsePastedRows('2024-02-29,30\n2023-12-31,31').rows, [
			{ date: '2024-02-29', wpm: '30' },
			{ date: '2023-12-31', wpm: '31' },
		]);
	});

	it('prefers tabs when a line has both', () => {
		const { rows } = parsePastedRows('2024-01-02\t3,5');
		assert.deepEqual(rows, []);
		assert.equal(parsePastedRows('2024-01-02\t3,5').skipped, 1);
	});

	it('is empty for empty text', () => {
		assert.deepEqual(parsePastedRows(''), { rows: [], skipped: 0 });
	});
});

describe('toPoints', () => {
	const row = (date, wpm) => ({ id: date + wpm, date, wpm });

	it('counts the first day after the start date as day 1', () => {
		const points = toPoints({ startDate: '2024-01-01', records: [row('2024-01-02', '30')] });
		assert.deepEqual(points, [{ date: '2024-01-02', days: 1, wpm: 30 }]);
	});

	it('counts whole days, across a month end and a leap day', () => {
		const points = toPoints({
			startDate: '2024-02-28',
			records: [row('2024-02-29', '1'), row('2024-03-01', '2'), row('2025-02-28', '3')],
		});
		assert.deepEqual(
			points.map((p) => p.days),
			[1, 2, 366],
		);
	});

	it('drops the start date itself and anything before it', () => {
		const points = toPoints({
			startDate: '2024-01-10',
			records: [row('2024-01-10', '30'), row('2024-01-09', '30'), row('2023-01-01', '30'), row('2024-01-11', '30')],
		});
		assert.deepEqual(
			points.map((p) => p.date),
			['2024-01-11'],
		);
	});

	it('drops rows that are not a date and a positive speed', () => {
		const points = toPoints({
			startDate: '2024-01-01',
			records: [
				row('', '30'),
				row('not a date', '30'),
				row('2024-01-05', ''),
				row('2024-01-05', '   '),
				row('2024-01-05', 'abc'),
				row('2024-01-05', '0'),
				row('2024-01-05', '-4'),
				row('2024-01-05', '12.5'),
			],
		});
		assert.deepEqual(points, [{ date: '2024-01-05', days: 4, wpm: 12.5 }]);
	});

	it('is empty without a usable start date', () => {
		assert.deepEqual(toPoints({ startDate: '', records: [row('2024-01-05', '30')] }), []);
		assert.deepEqual(toPoints({ startDate: 'soon', records: [row('2024-01-05', '30')] }), []);
	});

	it('sorts by day, and keeps several rows on the same day', () => {
		const points = toPoints({
			startDate: '2024-01-01',
			records: [row('2024-01-09', '3'), row('2024-01-03', '1'), row('2024-01-03', '2')],
		});
		assert.deepEqual(
			points.map((p) => [p.days, p.wpm]),
			[
				[2, 1],
				[2, 2],
				[8, 3],
			],
		);
	});
});
