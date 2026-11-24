import { type KeyboardEvent, useState } from "react";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";

interface EditableProps {
	value: string;
	label: string;
	placeholder?: string;
	multiline?: boolean;
	required?: boolean;
	type?: "text" | "date";
	display?: string;
	save: (next: string) => Promise<unknown>;
}

export function Editable({
	value,
	label,
	placeholder,
	multiline,
	required,
	type = "text",
	display,
	save,
}: EditableProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const cancel = () => {
		setDraft(null);

		setError(null);
	};

	const commit = () => {
		if (draft === null) return;

		const next = draft.trim();

		if (next === value.trim()) {
			cancel();

			return;
		}

		if (required === true && next === "") {
			setError(`${label} can't be empty.`);

			return;
		}

		setSaving(true);

		save(next).then(
			() => {
				setSaving(false);

				cancel();
			},
			(failure: unknown) => {
				setSaving(false);

				setError(describeError(failure));
			},
		);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();

			cancel();
		}

		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();

			commit();
		}
	};

	if (draft === null) {
		const empty = value === "";

		return (
			<button
				type="button"
				className={empty ? "editable is-empty" : "editable"}
				aria-label={`Edit ${label}`}
				onClick={() => setDraft(value)}
			>
				{empty ? (placeholder ?? `Add ${label}`) : (display ?? value)}
			</button>
		);
	}

	const common = {
		"aria-label": label,
		"aria-invalid": error !== null,
		value: draft,
		disabled: saving,
		ref: focusOnMount,
		onKeyDown,
		onBlur: () => {
			if (!saving && error === null) commit();
		},
	};

	return (
		<span className="editing">
			{multiline === true ? (
				<textarea {...common} className="textarea" rows={1} onChange={(event) => setDraft(event.target.value)} />
			) : (
				<input {...common} className="input" type={type} onChange={(event) => setDraft(event.target.value)} />
			)}
			{error === null ? null : (
				<span className="error-text" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}
