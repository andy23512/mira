import { newRecord, type OwnRecords, type RawRecord } from '../lib/records.ts';

interface Props {
	value: OwnRecords;
	onChange: (next: OwnRecords) => void;
}

/** Entry for the reader's own practice log. Nothing here is sent anywhere. */
export function RecordEditor({ value, onChange }: Props) {
	const setRecord = (id: string, patch: Partial<RawRecord>) => {
		const records = value.records.map((record) =>
			record.id === id ? { ...record, ...patch } : record,
		);
		onChange({ ...value, records });
	};

	const addRow = () => onChange({ ...value, records: [...value.records, newRecord()] });

	const removeRow = (id: string) => {
		const records = value.records.filter((record) => record.id !== id);
		onChange({ ...value, records: records.length > 0 ? records : [newRecord()] });
	};

	return (
		<div className="card">
			<h2>Your records</h2>
			<p className="note">
				Kept in this browser only — Mira has no account and sends nothing anywhere. The start
				date is the day the device arrived; the spreadsheet counts that as day 0, so the first
				day of practice is day 1.
			</p>

			<label className="field">
				<span>Start date</span>
				<input
					type="date"
					value={value.startDate}
					onChange={(event) => onChange({ ...value, startDate: event.target.value })}
				/>
			</label>

			<div className="records">
				<span className="records-head">Date</span>
				<span className="records-head">Words per minute</span>
				<span className="records-head" />
				{value.records.map((record) => (
					<Row
						key={record.id}
						record={record}
						onDate={(date) => setRecord(record.id, { date })}
						onWpm={(wpm) => setRecord(record.id, { wpm })}
						onRemove={() => removeRow(record.id)}
					/>
				))}
			</div>

			<div>
				<button type="button" onClick={addRow}>
					Add a record
				</button>
			</div>
		</div>
	);
}

interface RowProps {
	record: RawRecord;
	onDate: (value: string) => void;
	onWpm: (value: string) => void;
	onRemove: () => void;
}

function Row({ record, onDate, onWpm, onRemove }: RowProps) {
	return (
		<>
			<input
				type="date"
				aria-label="Record date"
				value={record.date}
				onChange={(event) => onDate(event.target.value)}
			/>
			<input
				type="number"
				inputMode="decimal"
				min="1"
				step="0.1"
				aria-label="Words per minute"
				value={record.wpm}
				onChange={(event) => onWpm(event.target.value)}
			/>
			<button type="button" className="link" onClick={onRemove}>
				Remove
			</button>
		</>
	);
}
