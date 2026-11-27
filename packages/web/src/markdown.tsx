import { type KeyboardEvent, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";

const plugins = [remarkGfm];

export function MarkdownText({ text, className }: { text: string; className?: string }) {
	return (
		<div className={className === undefined ? "md" : `md ${className}`}>
			<Markdown remarkPlugins={plugins}>{text}</Markdown>
		</div>
	);
}

/**
 * A Markdown document edited in place: click the text to edit its source in the same type, click away or ⌘↵ to
 * save, Escape to cancel.
 */
export function MarkdownField({
	value,
	label,
	placeholder,
	save,
}: {
	value: string;
	label: string;
	placeholder: string;
	save: (next: string) => Promise<unknown>;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const [height, setHeight] = useState(0);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const edit = (from: HTMLElement) => {
		setHeight(from.offsetHeight);

		setDraft(value);
	};

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

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();

			cancel();
		}

		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();

			commit();
		}
	};

	if (draft === null) {
		if (value === "")
			return (
				<button type="button" className="md-field unset" onClick={(event) => edit(event.currentTarget)}>
					{placeholder}
				</button>
			);

		return (
			<div className="md-field">
				<button
					type="button"
					className="md-hit"
					aria-label={`Edit ${label}`}
					onClick={(event) => edit(event.currentTarget)}
				/>
				<MarkdownText text={value} />
			</div>
		);
	}

	return (
		<div className="md-field editing">
			<textarea
				ref={focusOnMount}
				className="md-src"
				aria-label={label}
				aria-invalid={error !== null}
				placeholder={placeholder}
				value={draft}
				disabled={saving}
				style={{ minHeight: Math.max(height - 8, 26) }}
				onKeyDown={onKeyDown}
				onBlur={() => {
					if (!saving && error === null) commit();
				}}
				onChange={(event) => setDraft(event.target.value)}
			/>
			{error === null ? (
				<span className="md-hint">Markdown · click away or ⌘↵ to save · esc to cancel</span>
			) : (
				<span className="err" role="alert">
					{error}
				</span>
			)}
		</div>
	);
}
