import { useRef, useState, type ChangeEvent } from 'react';
import { newRecord, parsePastedRows, parseRecords, type OwnRecords, type RawRecord } from '../lib/records.ts';

interface Props {
	value: OwnRecords;
	onChange: (next: OwnRecords) => void;
}

/** Entry for the reader's own practice log. Nothing here is sent anywhere. */
export function RecordEditor({ value, onChange }: Props) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [pasteText, setPasteText] = useState('');
	const [pasteMessage, setPasteMessage] = useState<string | null>(null);

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

	const exportRecords = () => {
		const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `mira-records-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};

	const hasData = value.startDate !== '' || value.records.some((r) => r.date || r.wpm);

	const importRecords = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;

		const parsed = parseRecords(await file.text());
		if (!parsed) {
			setImportError('That file is not a Mira records export.');
			return;
		}
		if (hasData && !confirm('Replace your current records with the ones in this file?')) {
			return;
		}
		setImportError(null);
		onChange(parsed);
	};

	const addPastedRows = () => {
		const { rows, skipped } = parsePastedRows(pasteText);
		if (rows.length === 0) {
			setPasteMessage(
				skipped > 0
					? `Could not read any of the ${skipped} pasted line${skipped === 1 ? '' : 's'}.`
					: 'Paste some rows first.',
			);
			return;
		}
		const existing = value.records.filter((record) => record.date || record.wpm);
		const added = rows.map((row) => ({ ...newRecord(), ...row }));
		onChange({ ...value, records: [...existing, ...added] });
		setPasteMessage(
			`Added ${added.length} record${added.length === 1 ? '' : 's'}.` +
				(skipped > 0
					? ` Skipped ${skipped} line${skipped === 1 ? '' : 's'} that could not be read.`
					: ''),
		);
		setPasteText('');
		setPasteOpen(false);
	};

	return (
		<div className="card">
			<h2>Your records</h2>
			<p className="note">
				Kept in this browser only — Mira has no account and sends nothing anywhere. The start
				date is the day the device arrived; the spreadsheet counts that as day 0, so the first
				day of practice is day 1.
			</p>

			<div className="record-actions">
				<button type="button" onClick={exportRecords}>
					Export records
				</button>
				<button type="button" onClick={() => fileInputRef.current?.click()}>
					Import records
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept="application/json"
					className="visually-hidden"
					onChange={importRecords}
				/>
			</div>
			{importError && (
				<p className="note error" role="alert">
					{importError}
				</p>
			)}

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

			<div className="record-actions">
				<button type="button" onClick={addRow}>
					Add a record
				</button>
				<button type="button" onClick={() => setPasteOpen((open) => !open)}>
					{pasteOpen ? 'Cancel paste' : 'Paste rows'}
				</button>
			</div>

			{pasteOpen && (
				<>
					<label className="field">
						<span>Paste date,wpm rows — one per line, date as YYYY-MM-DD</span>
						<textarea
							rows={4}
							value={pasteText}
							onChange={(event) => setPasteText(event.target.value)}
							placeholder={'2026-01-05, 42\n2026-01-12, 47'}
						/>
					</label>
					<div>
						<button type="button" onClick={addPastedRows}>
							Add rows
						</button>
					</div>
				</>
			)}
			{pasteMessage && <p className="note">{pasteMessage}</p>}
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
