import {
	type Assumption,
	type Bet,
	type BetMethod,
	type BetResult,
	betLockedFields,
	betMethods,
	type CommandName,
	confidenceRange,
	defaultConfidence,
	type FailCause,
	judgeReading,
	type Learning,
	methodCeilings,
	methodLabels,
	type Reading,
	type ReadingSubject,
	type WorkFunction,
	type WorkProgress,
	workFunctions,
} from "@braise/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cloneElement, type FormEvent, type ReactElement, useId, useState } from "react";
import { DraftControls, DraftMeta, useDraftItem, useDraftSave, Was } from "./draft.tsx";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { refreshVenture } from "./live.ts";
import { amount, failPhrase, latestOf, learningVerdict, passPhrase, readingsOf, timeLeft } from "./loop-view.ts";
import { Dia, FunctionGlyph, Icon, Pips } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { actorName } from "./thread-timeline.ts";
import { shortDate } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";

export interface VentureRef {
	id: string;
	slug: string;
}

export const functionNames = {
	product: "Product",
	design: "Design",
	engineering: "Engineering",
	marketing: "Marketing",
	sales: "Sales",
	ops: "Ops",
} satisfies Record<WorkFunction, string>;

export const functionOptions = workFunctions.map((value) => ({
	value,
	label: functionNames[value],
	glyph: <FunctionGlyph fn={value} />,
}));

const methodOptions = betMethods.map((value) => ({
	value,
	label: methodLabels[value],
	sub: `Can earn confidence ${methodCeilings[value]}`,
}));

/** A command on the strategy loop: the cockpit is read again once it lands. */
export function useLoopCommand<Name extends CommandName>(name: Name, venture: VentureRef, done?: () => void) {
	const client = useQueryClient();

	return useCommand<Name, unknown>(name, (response) => {
		void refreshVenture(client, venture, response.seq);

		done?.();
	});
}

/** Confidence in an assumption: four diamonds, lit by the strongest evidence so far. */
export function Conf({ level }: { level: number }) {
	return (
		<span className="conf" role="img" aria-label={`Confidence ${level} of 4`} data-tip={`Confidence ${level} of 4`}>
			{[1, 2, 3, 4].map((step) => (
				<svg
					key={step}
					viewBox="0 0 8 8"
					width="8"
					height="8"
					className={step <= level ? "on" : undefined}
					aria-hidden="true"
				>
					<path d="M4 .6l3.4 3.4L4 7.4.6 4z" />
				</svg>
			))}
		</span>
	);
}

function today() {
	const now = new Date();

	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseNumber(text: string) {
	const value = Number(text.trim().replace(",", "."));

	return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

/** A captioned form field. The caption is tied to the one control passed as its child. */
export function Labeled(props: { label: string; hint?: string; children: ReactElement<{ id?: string }> }) {
	const id = useId();

	return (
		<div className="field">
			<label className="cap" htmlFor={id}>
				{props.label}
				{props.hint === undefined ? null : <span>{props.hint}</span>}
			</label>
			{cloneElement(props.children, { id })}
		</div>
	);
}

export function ReadingForm(props: {
	venture: VentureRef;
	subject: { type: ReadingSubject; id: string };
	unit: string;
	close: () => void;
}) {
	const [value, setValue] = useState("");
	const [takenOn, setTakenOn] = useState(today);
	const [source, setSource] = useState("");
	const number = parseNumber(value);

	const record = useLoopCommand("reading.record", props.venture, () => {
		toast("Reading recorded");

		props.close();
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (number === null || source.trim() === "") return;

		record.mutate({
			payload: { ventureId: props.venture.id, subject: props.subject, value: number, takenOn, source },
		});
	};

	return (
		<form
			className="reading-form"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<input
				className="inp num"
				inputMode="decimal"
				aria-label={props.unit === "" ? "Value" : `Value in ${props.unit}`}
				placeholder={props.unit === "" ? "Value" : `Value, ${props.unit}`}
				value={value}
				required
				ref={focusOnMount}
				onChange={(event) => setValue(event.target.value)}
			/>
			<input
				className="inp"
				type="date"
				aria-label="Taken on"
				value={takenOn}
				required
				onChange={(event) => setTakenOn(event.target.value)}
			/>
			<input
				className="inp"
				aria-label="Where the number comes from"
				placeholder="Where the number comes from"
				value={source}
				required
				maxLength={500}
				onChange={(event) => setSource(event.target.value)}
			/>
			<button type="submit" className="btn pri sm" disabled={record.isPending || number === null}>
				Record
			</button>
			<button type="button" className="btn ghost sm" onClick={props.close}>
				Cancel
			</button>
			{record.isError ? (
				<p className="err" role="alert">
					{describeError(record.error)}
				</p>
			) : null}
		</form>
	);
}

interface BetDraft {
	function: WorkFunction;
	action: string;
	signal: string;
	unit: string;
	baseline: string;
	passAt: string;
	failAt: string;
	method: BetMethod;
	budget: string;
	deadline: string;
}

function draftOf(bet: Bet | undefined, fallback: WorkFunction) {
	return {
		function: bet?.function ?? fallback,
		action: bet?.action ?? "",
		signal: bet?.signal ?? "",
		unit: bet?.unit ?? "",
		baseline: bet?.baseline === null || bet === undefined ? "" : String(bet.baseline),
		passAt: bet === undefined ? "" : String(bet.passAt),
		failAt: bet === undefined ? "" : String(bet.failAt),
		method: bet?.method ?? "before_after",
		budget: bet?.budget ?? "",
		deadline: bet?.deadline ?? "",
	} satisfies BetDraft;
}

/** Registers a bet, or edits an open one. Changing the test itself asks for a reason. */
export function BetForm(props: { venture: VentureRef; assumption: Assumption; bet?: Bet; close: () => void }) {
	const { bet, venture } = props;
	const [draft, setDraft] = useState(() => draftOf(bet, props.assumption.function));
	const [reason, setReason] = useState("");
	const create = useLoopCommand("bet.create", venture, props.close);
	const update = useLoopCommand("bet.update", venture, props.close);
	const busy = create.isPending || update.isPending;
	const error = create.error ?? update.error;
	const set = <Key extends keyof BetDraft>(key: Key, value: BetDraft[Key]) => setDraft({ ...draft, [key]: value });
	const passAt = parseNumber(draft.passAt);
	const failAt = parseNumber(draft.failAt);

	const numbers = {
		baseline: parseNumber(draft.baseline),
		passAt,
		failAt,
	};

	const next = { ...draft, ...numbers };

	const changed =
		bet === undefined ? [] : (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== bet[key]);

	const lockedChanged = changed.some((key) => (betLockedFields as readonly string[]).includes(key));

	const problem =
		passAt === null || failAt === null
			? "Give the pass and fail marks as numbers."
			: passAt === failAt
				? "The pass and fail marks must differ."
				: bet !== undefined && changed.length === 0
					? "Nothing changed yet."
					: lockedChanged && reason.trim() === ""
						? "Say why the test changes. Its marks were fixed when the bet was registered."
						: null;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (problem !== null || passAt === null || failAt === null || busy) return;

		if (bet === undefined) {
			create.mutate({
				payload: { ventureId: venture.id, assumptionId: props.assumption.id, ...next, passAt, failAt },
			});

			return;
		}

		update.mutate({
			payload: {
				ventureId: venture.id,
				betId: bet.id,
				...Object.fromEntries(changed.map((key) => [key, next[key]])),
			},
			reason: reason.trim() === "" ? undefined : reason.trim(),
		});
	};

	const lower = passAt !== null && failAt !== null && passAt < failAt;

	return (
		<form
			className="bet-form"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<p className="bet-form-on">
				<span className="cap">Tests</span> {props.assumption.statement}
			</p>
			<Labeled label="Action" hint="What will you do?">
				<textarea
					className="ta"
					rows={2}
					value={draft.action}
					required
					ref={focusOnMount}
					onChange={(event) => set("action", event.target.value)}
				/>
			</Labeled>
			<div className="bet-form-row">
				<Labeled label="Signal" hint="The number you will read">
					<input
						className="inp"
						value={draft.signal}
						required
						placeholder="Pre-orders a week"
						onChange={(event) => set("signal", event.target.value)}
					/>
				</Labeled>
				<Labeled label="Unit" hint="Optional">
					<input
						className="inp"
						value={draft.unit}
						maxLength={20}
						placeholder="%"
						onChange={(event) => set("unit", event.target.value)}
					/>
				</Labeled>
			</div>
			<div className="bet-form-row three">
				<Labeled label="Today" hint="Optional">
					<input
						className="inp num"
						inputMode="decimal"
						value={draft.baseline}
						onChange={(event) => set("baseline", event.target.value)}
					/>
				</Labeled>
				<Labeled label="Pass at">
					<input
						className="inp num"
						inputMode="decimal"
						value={draft.passAt}
						required
						onChange={(event) => set("passAt", event.target.value)}
					/>
				</Labeled>
				<Labeled label={lower ? "Fail over" : "Fail under"}>
					<input
						className="inp num"
						inputMode="decimal"
						value={draft.failAt}
						required
						onChange={(event) => set("failAt", event.target.value)}
					/>
				</Labeled>
			</div>
			<p className="cap bet-form-note">
				Anything between the two marks is inconclusive. Fixing them now is what keeps the result honest.
			</p>
			<div className="bet-form-row three">
				<div className="field">
					<span className="cap">Method</span>
					<Select
						title="Method"
						value={draft.method}
						options={methodOptions}
						onChange={(value) => set("method", value)}
					/>
				</div>
				<div className="field">
					<span className="cap">Led by</span>
					<Select
						title="Function"
						value={draft.function}
						options={functionOptions}
						onChange={(value) => set("function", value)}
					/>
				</div>
				<Labeled label="Deadline">
					<input
						className="inp"
						type="date"
						value={draft.deadline}
						required
						onChange={(event) => set("deadline", event.target.value)}
					/>
				</Labeled>
			</div>
			<Labeled label="Budget" hint="Optional">
				<input
					className="inp"
					value={draft.budget}
					maxLength={200}
					placeholder="€140, 4 weeks"
					onChange={(event) => set("budget", event.target.value)}
				/>
			</Labeled>
			{lockedChanged ? (
				<Labeled label="Why the test changes" hint="Recorded with the change">
					<input
						className="inp"
						value={reason}
						maxLength={2000}
						onChange={(event) => setReason(event.target.value)}
					/>
				</Labeled>
			) : null}
			{error === null ? null : (
				<p className="err" role="alert">
					{describeError(error)}
				</p>
			)}
			<div className="form-acts">
				<button type="submit" className="btn pri" disabled={busy || problem !== null}>
					{bet === undefined ? (busy ? "Registering…" : "Register bet") : busy ? "Saving…" : "Save changes"}
				</button>
				<button type="button" className="btn ghost" onClick={props.close}>
					Cancel<span className="kbd">esc</span>
				</button>
				{problem === null || draft.action === "" ? null : <span className="cap">{problem}</span>}
			</div>
		</form>
	);
}

const resultNames = { pass: "Passed", fail: "Failed", inconclusive: "Inconclusive" } satisfies Record<
	BetResult,
	string
>;

function CloseForm(props: {
	venture: VentureRef;
	bet: Bet;
	number: string;
	assumption: Assumption;
	latest: Reading | null;
	close: () => void;
}) {
	const { bet, assumption, latest } = props;
	const judged = latest === null ? null : judgeReading(bet, latest.value);
	const [result, setResult] = useState<BetResult>(judged ?? "inconclusive");
	const [cause, setCause] = useState<FailCause>(judged === "fail" ? "idea" : "execution");
	const [statement, setStatement] = useState("");
	const [chosen, setChosen] = useState<number | null>(null);

	const verdict = {
		result,
		cause: result === "fail" ? cause : undefined,
		method: bet.method,
		current: assumption.confidence,
	};

	const range = confidenceRange(verdict);

	const confidenceTo =
		chosen !== null && chosen >= range.min && chosen <= range.max ? chosen : defaultConfidence(verdict);

	const closeBet = useLoopCommand("bet.close", props.venture, () => {
		toast(
			<>
				Bet {props.number} closed · <b>{resultNames[result].toLowerCase()}</b>
			</>,
		);

		props.close();
	});

	const blocked =
		result === "pass" && judged !== "pass"
			? latest === null
				? "A pass needs a reading at the pass mark. Record one first."
				: `The latest reading, ${amount(latest.value, bet.unit)}, doesn't reach the pass mark.`
			: result === "fail" && cause === "idea" && judged !== "fail"
				? "The reading isn't past the fail mark, so the idea isn't refuted. Close it as inconclusive, or as failed on execution."
				: null;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (blocked !== null || statement.trim() === "" || closeBet.isPending) return;

		closeBet.mutate({
			payload: {
				ventureId: props.venture.id,
				betId: bet.id,
				result,
				cause: result === "fail" ? cause : undefined,
				statement,
				confidenceTo,
			},
		});
	};

	const steps = Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index);

	return (
		<form
			className="close-form"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<div className="close-row">
				<span className="cap">Result</span>
				<fieldset className="seg">
					<legend className="vh">Result</legend>
					{(["pass", "fail", "inconclusive"] as const).map((option) => (
						<button
							key={option}
							type="button"
							aria-pressed={result === option}
							onClick={() => {
								setResult(option);

								setChosen(null);
							}}
						>
							{resultNames[option]}
						</button>
					))}
				</fieldset>
				{judged === null ? (
					<span className="cap">No reading yet</span>
				) : (
					<span className="cap">
						The reading says {resultNames[judged].toLowerCase()}: {amount(latest?.value ?? 0, bet.unit)} against{" "}
						{passPhrase(bet)}
					</span>
				)}
			</div>
			{result === "fail" ? (
				<div className="close-row">
					<span className="cap">What was wrong</span>
					<fieldset className="seg">
						<legend className="vh">What was wrong</legend>
						<button
							type="button"
							aria-pressed={cause === "idea"}
							onClick={() => {
								setCause("idea");

								setChosen(null);
							}}
						>
							The idea
						</button>
						<button
							type="button"
							aria-pressed={cause === "execution"}
							onClick={() => {
								setCause("execution");

								setChosen(null);
							}}
						>
							The execution
						</button>
					</fieldset>
					<span className="cap">Only a wrong idea lowers confidence</span>
				</div>
			) : null}
			<Labeled label="Learning" hint="One or two sentences worth remembering">
				<textarea
					className="ta"
					rows={2}
					value={statement}
					required
					maxLength={2000}
					ref={focusOnMount}
					onChange={(event) => setStatement(event.target.value)}
				/>
			</Labeled>
			<div className="close-row">
				<span className="cap">Confidence</span>
				<Conf level={assumption.confidence} />
				<Icon name="right" />
				{steps.length === 1 ? (
					<Conf level={confidenceTo} />
				) : (
					<fieldset className="seg">
						<legend className="vh">Confidence after</legend>
						{steps.map((step) => (
							<button
								key={step}
								type="button"
								aria-pressed={confidenceTo === step}
								onClick={() => setChosen(step)}
							>
								{step}
							</button>
						))}
					</fieldset>
				)}
				<span className="cap">
					{result === "pass"
						? `${methodLabels[bet.method]} can earn ${methodCeilings[bet.method]}`
						: confidenceTo === assumption.confidence
							? "Stays where it is"
							: confidenceTo === 0
								? "At 0 the assumption is marked false"
								: "Goes down"}
				</span>
			</div>
			{blocked !== null || closeBet.isError ? (
				<p className="err" role="alert">
					{closeBet.isError ? describeError(closeBet.error) : blocked}
				</p>
			) : null}
			<div className="form-acts">
				<button
					type="submit"
					className="btn pri"
					disabled={closeBet.isPending || blocked !== null || statement.trim() === ""}
				>
					{closeBet.isPending ? "Closing…" : `Close as ${resultNames[result].toLowerCase()}`}
				</button>
				<button type="button" className="btn ghost" onClick={props.close}>
					Cancel<span className="kbd">esc</span>
				</button>
			</div>
		</form>
	);
}

type Mode = "view" | "edit" | "close" | "reading";

/** An open bet under its assumption: one line that opens to the registered test, its readings and its actions. */
export function BetBlock(props: {
	venture: VentureRef;
	bet: Bet;
	number: string;
	assumption: Assumption;
	readings: readonly Reading[];
	progress: WorkProgress | undefined;
	fresh: boolean;
}) {
	const { bet, venture, assumption, progress } = props;
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("view");
	const now = Date.now();
	const series = readingsOf(props.readings, "bet", bet.id);
	const latest = latestOf(props.readings, "bet", bet.id);
	const judged = latest === null ? null : judgeReading(bet, latest.value);
	const archive = useLoopCommand("bet.archive", venture);
	const bodyId = `bet-${bet.id}`;
	const drafted = useDraftItem(bet.id);
	const className = ["betx", props.fresh ? "fresh" : "", drafted.className].filter(Boolean).join(" ");

	if (drafted.mark !== null) {
		return <DraftedBet bet={bet} number={props.number} item={drafted} className={className} />;
	}

	return (
		<div className={className}>
			<button
				type="button"
				className="betx-h"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => setOpen(!open)}
			>
				<span className="bet-n">{props.number}</span>
				<span className="betx-t">
					<b>{bet.action}</b>
					<span>
						{latest === null
							? "No reading yet"
							: `${amount(latest.value, "")} of ${amount(bet.passAt, bet.unit)}`}{" "}
						· {failPhrase(bet)} · {methodLabels[bet.method].toLowerCase()}
					</span>
				</span>
				<span className={judged === "pass" ? "tag ok" : "tag plain"}>
					{judged === "pass" ? "At the pass mark" : timeLeft(bet.deadline, now)}
				</span>
				<Icon name={open ? "chevd" : "chevr"} />
			</button>

			{open ? (
				<div className="betx-b" id={bodyId}>
					{mode === "edit" ? (
						<BetForm venture={venture} assumption={assumption} bet={bet} close={() => setMode("view")} />
					) : (
						<>
							<p className="sent">
								Because we believe <u>{assumption.statement}</u>, if we <u>{bet.action}</u>, then{" "}
								<u>{bet.signal}</u> will{" "}
								{bet.baseline === null ? "reach" : `go from ${amount(bet.baseline, bet.unit)} to`}{" "}
								<u>{passPhrase(bet)}</u> by <u>{shortDate(bet.deadline, now)}</u>.
							</p>
							<dl className="facts">
								<div>
									<dt className="cap">Pass at</dt>
									<dd>{amount(bet.passAt, bet.unit)}</dd>
								</div>
								<div>
									<dt className="cap">{bet.passAt > bet.failAt ? "Fail under" : "Fail over"}</dt>
									<dd>{amount(bet.failAt, bet.unit)}</dd>
								</div>
								<div>
									<dt className="cap">Method</dt>
									<dd>{methodLabels[bet.method]}</dd>
								</div>
								<div>
									<dt className="cap">Can earn</dt>
									<dd>Confidence {methodCeilings[bet.method]}</dd>
								</div>
								<div>
									<dt className="cap">Led by</dt>
									<dd>{functionNames[bet.function]}</dd>
								</div>
								<div>
									<dt className="cap">Budget</dt>
									<dd>{bet.budget === "" ? <span className="mute">None set</span> : bet.budget}</dd>
								</div>
							</dl>

							{series.length === 0 ? null : (
								<ol className="reads">
									{series.toReversed().map((reading) => (
										<li key={reading.id}>
											<b className="mono">{amount(reading.value, bet.unit)}</b>
											<span>{shortDate(reading.takenOn, now)}</span>
											<span className="mute">
												{reading.source} · {actorName(reading.enteredBy)}
											</span>
										</li>
									))}
								</ol>
							)}

							{mode === "reading" ? (
								<ReadingForm
									venture={venture}
									subject={{ type: "bet", id: bet.id }}
									unit={bet.unit}
									close={() => setMode("view")}
								/>
							) : null}

							{mode === "close" ? (
								<CloseForm
									venture={venture}
									bet={bet}
									number={props.number}
									assumption={assumption}
									latest={latest}
									close={() => setMode("view")}
								/>
							) : null}

							{mode === "view" ? (
								<div className="betx-acts">
									<button type="button" className="btn sm" onClick={() => setMode("reading")}>
										<Icon name="plus" />
										Record reading
									</button>
									<button type="button" className="btn sm" onClick={() => setMode("close")}>
										<Icon name="check" />
										Close bet
									</button>
									<Link
										to="/v/$slug/work"
										params={{ slug: venture.slug }}
										hash={`home-bet:${bet.id}`}
										className="goal-p mono"
										data-tip="Open this bet’s work"
									>
										{progress === undefined || progress.total === 0 ? (
											"No work yet"
										) : (
											<>
												<Pips done={progress.done} total={progress.total} />
												{progress.done}/{progress.total}
											</>
										)}
									</Link>
									<span className="grow" />
									<button type="button" className="btn ghost sm" onClick={() => setMode("edit")}>
										<Icon name="edit" />
										Edit
									</button>
									<button
										type="button"
										className="ib"
										aria-label="Archive bet"
										data-tip="Archive bet|for a bet registered by mistake"
										disabled={archive.isPending}
										onClick={() => archive.mutate({ payload: { ventureId: venture.id, betId: bet.id } })}
									>
										<Icon name="archive" />
									</button>
								</div>
							) : null}

							{archive.isError ? (
								<p className="err" role="alert">
									{describeError(archive.error)}
								</p>
							) : null}
						</>
					)}
				</div>
			) : null}
		</div>
	);
}

function DraftedBet({
	bet,
	number,
	item,
	className,
}: {
	bet: Bet;
	number: string;
	item: ReturnType<typeof useDraftItem>;
	className: string;
}) {
	const now = Date.now();
	const save = useDraftSave(item);
	const editable = item.created;

	const field = (name: "action" | "deadline" | "passAt", value: string) =>
		save(name, name === "passAt" ? Number(value) : value, () => Promise.resolve());

	return (
		<div className={className} {...item.attrs}>
			<div className="betx-h">
				<span className="bet-n">{number}</span>
				<span className="betx-t">
					<b>
						{editable ? (
							<Editable label="action" value={bet.action} required save={(value) => field("action", value)} />
						) : (
							bet.action
						)}
						<Was item={item} field="action" />
					</b>
					<span>
						<DraftMeta item={item} /> · pass at{" "}
						{editable ? (
							<Editable
								label="pass mark"
								value={String(bet.passAt)}
								display={amount(bet.passAt, bet.unit)}
								save={(value) => field("passAt", value)}
							/>
						) : (
							amount(bet.passAt, bet.unit)
						)}{" "}
						· {failPhrase(bet)} · {methodLabels[bet.method].toLowerCase()} · by{" "}
						{editable ? (
							<Editable
								label="deadline"
								type="date"
								value={bet.deadline}
								display={shortDate(bet.deadline, now)}
								save={(value) => field("deadline", value)}
							/>
						) : (
							shortDate(bet.deadline, now)
						)}
						<Was item={item} field="deadline" format={(value) => `by ${shortDate(String(value), now)}`} />
						<Was item={item} field="passAt" format={(value) => `pass at ${amount(Number(value), bet.unit)}`} />
					</span>
				</span>
				<DraftControls changes={item.changes} />
			</div>
		</div>
	);
}

/** A closed bet, shown as the learning it left. */
export function LearningLine({ learning, number }: { learning: Learning; number: string | undefined }) {
	return (
		<li className="learned">
			<Dia status={learning.result === "pass" ? "done" : learning.result === "fail" ? "lost" : "todo"} />
			<p>
				{learning.statement}
				<span className="cap">
					{number === undefined ? "" : `${number} `}
					{learningVerdict(learning)}
					{learning.confidenceFrom === learning.confidenceTo
						? ""
						: ` · confidence ${learning.confidenceFrom} to ${learning.confidenceTo}`}{" "}
					· {shortDate(learning.createdAt.slice(0, 10), Date.now())}
				</span>
			</p>
		</li>
	);
}
