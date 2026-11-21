import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ordinal, rankLabel } from '../src/lib/format.ts';
import { SPEED_MILESTONES } from '../src/lib/speedMilestones.ts';

describe('ordinal', () => {
	it('uses st, nd, rd and th', () => {
		const expected = {
			0: '0th', 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 9: '9th', 10: '10th',
			21: '21st', 22: '22nd', 23: '23rd', 24: '24th', 30: '30th', 31: '31st', 99: '99th',
			100: '100th', 101: '101st', 102: '102nd', 103: '103rd',
		};
		for (const [value, text] of Object.entries(expected)) assert.equal(ordinal(Number(value)), text);
	});

	it('writes 11th, 12th and 13th, also past a hundred', () => {
		for (const value of [11, 12, 13, 111, 112, 113, 211]) assert.equal(ordinal(value), `${value}th`);
	});

	it('rounds first', () => {
		assert.equal(ordinal(1.6), '2nd');
		assert.equal(ordinal(10.4), '10th');
		assert.equal(ordinal(20.5), '21st');
		assert.equal(ordinal(49.99), '50th');
	});
});

describe('rankLabel', () => {
	it('names the percentile when there is one', () => {
		assert.equal(rankLabel({ percentile: 37.5, beyond: null, at: {} }), '38th');
		assert.equal(rankLabel({ percentile: 90, beyond: null, at: {} }), '90th');
	});

	it('names the bound outside the fitted span', () => {
		assert.equal(rankLabel({ percentile: null, beyond: 'above', at: {} }), 'above p90');
		assert.equal(rankLabel({ percentile: null, beyond: 'below', at: {} }), 'below p10');
	});

	it('shows a dash when it knows neither', () => {
		assert.equal(rankLabel({ percentile: null, beyond: null, at: {} }), '—');
	});

	it('does not mistake a percentile of 0 for none', () => {
		assert.equal(rankLabel({ percentile: 0, beyond: null, at: {} }), '0th');
	});
});

describe('SPEED_MILESTONES', () => {
	it('lists distinct speeds from slow to fast, each with a label and a description', () => {
		const speeds = SPEED_MILESTONES.map((m) => m.wpm);
		assert.deepEqual([...speeds].sort((l, r) => l - r), speeds);
		assert.equal(new Set(speeds).size, speeds.length);
		for (const m of SPEED_MILESTONES) {
			assert.ok(m.label.length > 0 && m.description.length > 0, String(m.wpm));
		}
		assert.deepEqual(speeds, [40, 60, 100, 150, 250]);
	});
});
