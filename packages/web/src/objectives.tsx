import {
	type Assumption,
	type AssumptionStatus,
	type Cockpit,
	type Impact,
	impacts,
	type Objective,
	type ObjectiveKind,
	rankAssumptions,
	type WorkFunction,
	workHomeKey,
} from "@braise/core";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import {
	BetBlock,
	BetForm,
	Conf,
	functionNames,
	functionOptions,
	Labeled,
	LearningLine,
	ReadingForm,
	useLoopCommand,
	type VentureRef,
} from "./bets.tsx";
import { DraftControls, DraftMeta, useDraftItem, useDraftSave, useStatusDrafted, Was } from "./draft.tsx";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { betNumbers } from "./labels.ts";
import {
	amount,
	assumptionState,
	impactNames,
	kindNames,
	latestOf,
	readingsOf,
	shareOfWay,
	timeBox,
	timeLeft,
} from "./loop-view.ts";
import { Dia, Icon, Need, Pips } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Sec } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
import { formatDate, shortDate } from "./time.ts";
import { toast } from "./toast.ts";

let lastFunction: WorkFunction = "product";

const impactOptions = impacts.toReversed().map((value) => ({ value, label: impactNames[value] }));

const kindChoices: { kind: ObjectiveKind; name: string; when: string }[] = [
	{ kind: "build", name: "Build", when: "Mostly vision, nothing to measure yet. A done list and a time box." },
	{
		kind: "learning",
		name: "Learning",
		when: "Something to show people. A question whose answer changes a decision.",
	},
	{ kind: "metric", name: "Metric", when: "A number tracks progress. A baseline, a target and a date." },
];

function parseNumber(text: string) {
	const value = Number(text.trim().replace(",", "."));

	return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

export function AddObjectiveForm({ venture, close }: { venture: VentureRef; close: () => void }) {
	const [kind, setKind] = useState<ObjectiveKind>("build");

	const [fields, setFields] = useState({
		statement: "",
		byDate: "",
		measure: "",
		unit: "",
		baseline: "",
		target: "",
		decision: "",
		doneRule: "",
		doneList: "",
		guardrails: "",
		budget: "",
	});

	const create = useLoopCommand("objective.create", venture, close);
	const set = (key: keyof typeof fields, value: string) => setFields({ ...fields, [key]: value });
	const baseline = parseNumber(fields.baseline);
	const target = parseNumber(fields.target);

	const doneList = fields.doneList
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");

	const problem =
		kind === "metric" && (baseline === null || target === null)
			? "Give the baseline and the target as numbers."
			: kind === "metric" && baseline === target
				? "The target must differ from the baseline."
				: kind === "build" && doneList.length === 0
					? "Write at least one line of what done means."
					: null;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (problem !== null || create.isPending) return;

		const common = {
			ventureId: venture.id,
			statement: fields.statement,
			guardrails: fields.guardrails,
			budget: fields.budget,
		};

		if (kind === "metric" && baseline !== null && target !== null) {
			create.mutate({
				payload: {
					...common,
					kind,
					measure: fields.measure,
					unit: fields.unit,
					baseline,
					target,
					byDate: fields.byDate,
				},
			});
		}

		if (kind === "learning") {
			create.mutate({
				payload: {
					...common,
					kind,
					decision: fields.decision,
					doneRule: fields.doneRule,
					byDate: fields.byDate === "" ? null : fields.byDate,
				},
			});
		}

		if (kind === "build") create.mutate({ payload: { ...common, kind, doneList, byDate: fields.byDate } });
	};

	const text = (key: keyof typeof fields, label: string, hint?: string, required = true) => (
		<Labeled label={label} hint={hint}>
			<input
				className="inp"
				value={fields[key]}
				required={required}
				onChange={(event) => set(key, event.target.value)}
			/>
		</Labeled>
	);

	return (
		<form
			className="bet add-obj"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") close();
			}}
		>
			<fieldset className="kinds">
				<legend className="vh">Kind of objective</legend>
				{kindChoices.map((choice) => (
					<button
						key={choice.kind}
						type="button"
						aria-pressed={kind === choice.kind}
						onClick={() => setKind(choice.kind)}
					>
						<b>{choice.name}</b>
						<span>{choice.when}</span>
					</button>
				))}
			</fieldset>

			<Labeled
				label={kind === "learning" ? "Question" : kind === "build" ? "What should exist" : "Objective"}
				hint={
					kind === "learning"
						? "What do you need to find out?"
						: kind === "build"
							? "The thing, in one line"
							: "Where the number has to get to"
				}
			>
				<input
					className="inp"
					value={fields.statement}
					required
					maxLength={1000}
					ref={focusOnMount}
					onChange={(event) => set("statement", event.target.value)}
				/>
			</Labeled>

			{kind === "metric" ? (
				<>
					<div className="bet-form-row">
						{text("measure", "Measure", "What is counted")}
						<Labeled label="Unit" hint="Optional">
							<input
								className="inp"
								value={fields.unit}
								maxLength={20}
								placeholder="%"
								onChange={(event) => set("unit", event.target.value)}
							/>
						</Labeled>
					</div>
					<div className="bet-form-row three">
						<Labeled label="Baseline">
							<input
								className="inp num"
								inputMode="decimal"
								value={fields.baseline}
								required
								onChange={(event) => set("baseline", event.target.value)}
							/>
						</Labeled>
						<Labeled label="Target">
							<input
								className="inp num"
								inputMode="decimal"
								value={fields.target}
								required
								onChange={(event) => set("target", event.target.value)}
							/>
						</Labeled>
						<Labeled label="By">
							<input
								className="inp"
								type="date"
								value={fields.byDate}
								required
								onChange={(event) => set("byDate", event.target.value)}
							/>
						</Labeled>
					</div>
				</>
			) : null}

			{kind === "learning" ? (
				<>
					{text("decision", "Decision it changes", "What will you do differently?")}
					<div className="bet-form-row">
						{text("doneRule", "Answered when", "The rule that ends it")}
						<Labeled label="By" hint="Optional">
							<input
								className="inp"
								type="date"
								value={fields.byDate}
								onChange={(event) => set("byDate", event.target.value)}
							/>
						</Labeled>
					</div>
				</>
			) : null}

			{kind === "build" ? (
				<div className="bet-form-row">
					<Labeled label="Done means" hint="One line each">
						<textarea
							className="ta"
							rows={3}
							value={fields.doneList}
							required
							onChange={(event) => set("doneList", event.target.value)}
						/>
					</Labeled>
					<Labeled label="Time box ends">
						<input
							className="inp"
							type="date"
							value={fields.byDate}
							required
							onChange={(event) => set("byDate", event.target.value)}
						/>
					</Labeled>
				</div>
			) : (
				<div className="bet-form-row">
					{text("guardrails", "Guardrails", "What must not get worse. Optional", false)}
					{text("budget", "Budget", "Optional", false)}
				</div>
			)}

			{create.isError ? (
				<p className="err" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
			<div className="form-acts">
				<button type="submit" className="btn pri" disabled={create.isPending || problem !== null}>
					{create.isPending ? "Adding…" : "Add objective"}
				</button>
				<button type="button" className="btn ghost" onClick={close}>
					Cancel<span className="kbd">esc</span>
				</button>
				{problem === null || fields.statement === "" ? null : <span className="cap">{problem}</span>}
			</div>
		</form>
	);
}

function Trend({ objective, values }: { objective: Objective; values: { takenOn: string; value: number }[] }) {
	const { baseline, target } = objective;

	if (baseline === null || target === null || objective.byDate === null) return null;

	const start = Math.min(
		Date.parse(objective.createdAt.slice(0, 10)),
		...values.map((reading) => Date.parse(reading.takenOn)),
	);

	const end = Math.max(Date.parse(objective.byDate), start + 1);
	const width = 520;
	const height = 84;
	const x = (iso: string) => 4 + Math.min(1, Math.max(0, (Date.parse(iso) - start) / (end - start))) * (width - 8);
	const y = (value: number) => height - 8 - shareOfWay(baseline, target, value) * (height - 20);

	const read = values.map((reading) => ({ px: x(reading.takenOn), py: y(reading.value) }));
	const points = read[0] !== undefined && read[0].px <= 4 ? read : [{ px: 4, py: y(baseline) }, ...read];

	const last = points.at(-1);
	const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.px.toFixed(1)} ${point.py.toFixed(1)}`);

	return (
		<svg className="trend" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
			<path className="trend-goal" d={`M4 ${y(target)}H${width - 4}`} />
			<path className="trend-base" d={`M4 ${y(baseline)}H${width - 4}`} />
			<path className="trend-line" d={path.join(" ")} />
			{last === undefined ? null : <circle className="trend-now" cx={last.px} cy={last.py} r="3.5" />}
		</svg>
	);
}

function Closing({ venture, objective }: { venture: VentureRef; objective: Objective }) {
	const [asking, setAsking] = useState(false);

	const close = useLoopCommand("objective.close", venture, () => {
		toast(objective.kind === "build" ? "Objective closed. What is now worth testing?" : "Objective closed");
	});

	const archive = useLoopCommand("objective.archive", venture);
	const error = close.error ?? archive.error;

	if (!asking) {
		return (
			<button
				type="button"
				className="ib"
				aria-label="Close objective"
				data-tip="Close objective"
				onClick={() => setAsking(true)}
			>
				<Icon name="check" />
			</button>
		);
	}

	const send = (status: "met" | "dropped") =>
		close.mutate({ payload: { ventureId: venture.id, objectiveId: objective.id, status } });

	return (
		<fieldset className="settle obj-close">
			<legend className="vh">Close objective</legend>
			<button type="button" className="btn pri sm" disabled={close.isPending} onClick={() => send("met")}>
				{objective.kind === "learning" ? "Answered" : objective.kind === "build" ? "Done" : "Met"}
			</button>
			<button type="button" className="btn sm" disabled={close.isPending} onClick={() => send("dropped")}>
				Drop it
			</button>
			<button
				type="button"
				className="btn ghost sm"
				disabled={archive.isPending}
				data-tip="Remove it|for an objective added by mistake"
				onClick={() => archive.mutate({ payload: { ventureId: venture.id, objectiveId: objective.id } })}
			>
				Archive
			</button>
			<button type="button" className="btn ghost sm" onClick={() => setAsking(false)}>
				Cancel
			</button>
			{error === null ? null : (
				<p className="err" role="alert">
					{describeError(error)}
				</p>
			)}
		</fieldset>
	);
}

interface CardProps {
	venture: VentureRef;
	objective: Objective;
	cockpit: Cockpit;
	numbers: Map<string, string>;
	fresh: ReadonlySet<string>;
}

export function ObjectiveCard(props: CardProps) {
	const { venture, objective } = props;
	const now = Date.now();
	const update = useLoopCommand("objective.update", venture);
	const base = { ventureId: venture.id, objectiveId: objective.id };
	const drafted = useDraftItem(objective.id);
	const draftSave = useDraftSave(drafted);

	const save =
		(field: "statement" | "guardrails" | "budget" | "decision" | "doneRule" | "measure") => (value: string) =>
			draftSave(field, value, () => update.mutateAsync({ payload: { ...base, [field]: value } }));

	const due =
		objective.byDate === null
			? "no date"
			: `${objective.kind === "build" ? "ends" : "due"} ${shortDate(objective.byDate, now)} · ${timeLeft(objective.byDate, now)}`;

	return (
		<article
			className={["bet ocard", props.fresh.has(objective.id) ? "fresh" : "", drafted.className]
				.filter(Boolean)
				.join(" ")}
			{...drafted.attrs}
		>
			<header className="bet-h">
				<h3>
					<Editable label="objective" value={objective.statement} required multiline save={save("statement")} />
					<Was item={drafted} field="statement" />
				</h3>
				{drafted.mark === null ? (
					<Closing venture={venture} objective={objective} />
				) : (
					<DraftControls changes={drafted.changes} />
				)}
			</header>
			<p className="cap obj-meta">
				{drafted.mark === null ? null : (
					<>
						<DraftMeta item={drafted} />
						{" · "}
					</>
				)}
				{kindNames[objective.kind]}
				{objective.kind === "build" ? " · by vision, not tested" : ""} ·{" "}
				<Editable
					label={objective.kind === "build" ? "end of the time box" : "due date"}
					type="date"
					value={objective.byDate ?? ""}
					placeholder="Set a date"
					display={due}
					save={(value) =>
						draftSave("byDate", value === "" ? null : value, () =>
							update.mutateAsync({ payload: { ...base, byDate: value === "" ? null : value } }),
						)
					}
				/>
			</p>

			{objective.kind === "metric" ? <MetricBody {...props} save={save} /> : null}
			{objective.kind === "learning" ? (
				<dl className="bet-kv obj-kv">
					<dt className="cap">Decision it changes</dt>
					<dd>
						<Editable
							label="decision"
							value={objective.decision ?? ""}
							required
							multiline
							save={save("decision")}
						/>
					</dd>
					<dt className="cap">Answered when</dt>
					<dd>
						<Editable
							label="done rule"
							value={objective.doneRule ?? ""}
							required
							multiline
							save={save("doneRule")}
						/>
					</dd>
				</dl>
			) : null}

			{objective.kind === "build" ? (
				<BuildBody {...props} />
			) : (
				<>
					<dl className="bet-kv obj-kv">
						<dt className="cap">Guardrails</dt>
						<dd>
							<Editable
								label="guardrails"
								value={objective.guardrails}
								multiline
								placeholder="What must not get worse on the way?"
								save={save("guardrails")}
							/>
						</dd>
						<dt className="cap">Budget</dt>
						<dd>
							<Editable
								label="budget"
								value={objective.budget}
								placeholder="What may be spent testing?"
								save={save("budget")}
							/>
						</dd>
					</dl>
					<Assumptions {...props} />
				</>
			)}

			{update.isError ? (
				<p className="err bet-err" role="alert">
					{describeError(update.error)}
				</p>
			) : null}
		</article>
	);
}

function MetricBody(props: CardProps & { save: (field: "measure") => (value: string) => Promise<unknown> }) {
	const { objective, cockpit, venture } = props;
	const [recording, setRecording] = useState(false);
	const series = readingsOf(cockpit.readings, "objective", objective.id);
	const latest = latestOf(cockpit.readings, "objective", objective.id);
	const { baseline, target, unit } = objective;

	if (baseline === null || target === null) return null;

	return (
		<div className="obj-m">
			<Trend objective={objective} values={series} />
			<dl className="obj-nums">
				<div className="now">
					<dt className="cap">Now</dt>
					<dd>{latest === null ? <span className="mute">No reading</span> : amount(latest.value, unit)}</dd>
				</div>
				<div>
					<dt className="cap">Baseline</dt>
					<dd>{amount(baseline, unit)}</dd>
				</div>
				<div>
					<dt className="cap">Target</dt>
					<dd>{amount(target, unit)}</dd>
				</div>
				<div className="wide">
					<dt className="cap">Measure</dt>
					<dd>
						<Editable label="measure" value={objective.measure ?? ""} required save={props.save("measure")} />
					</dd>
				</div>
			</dl>
			{recording ? (
				<ReadingForm
					venture={venture}
					subject={{ type: "objective", id: objective.id }}
					unit={unit}
					close={() => setRecording(false)}
				/>
			) : (
				<button type="button" className="addline obj-read" onClick={() => setRecording(true)}>
					<Icon name="plus" />
					{latest === null
						? "Record the first reading"
						: `Record a reading. Last: ${shortDate(latest.takenOn, Date.now())}, ${latest.source}`}
				</button>
			)}
		</div>
	);
}

function BuildBody({ venture, objective, cockpit }: CardProps) {
	const now = Date.now();
	const [adding, setAdding] = useState("");
	const check = useLoopCommand("objective.check", venture);
	const update = useLoopCommand("objective.update", venture, () => setAdding(""));
	const base = { ventureId: venture.id, objectiveId: objective.id };
	const list = objective.doneList;
	const done = list.filter((item) => item.done).length;
	const box = objective.byDate === null ? null : timeBox(objective.createdAt, objective.byDate, now);
	const progress = cockpit.workProgress[workHomeKey({ betId: null, objectiveId: objective.id })];
	const kept = list.map((item) => ({ id: item.id, text: item.text }));
	const error = check.error ?? update.error;

	return (
		<div className="obj-b">
			{box === null ? null : (
				<div className="tb">
					<span className="bar-p">
						<i style={{ width: `${box.share * 100}%` }} />
					</span>
					<span className="cap">
						Day {box.day} of {box.total}
					</span>
				</div>
			)}

			<h4 className="obj-sub">
				Done means
				<span className="cnt">
					{done} of {list.length}
				</span>
			</h4>
			<ul className="done">
				{list.map((item) => (
					<li key={item.id} className={item.done ? "is-done" : undefined}>
						<button
							type="button"
							className="st"
							aria-pressed={item.done}
							aria-label={item.done ? `Untick: ${item.text}` : `Tick: ${item.text}`}
							disabled={check.isPending}
							onClick={() => check.mutate({ payload: { ...base, itemId: item.id, done: !item.done } })}
						>
							<Dia status={item.done ? "done" : "todo"} />
						</button>
						<Editable
							label="done-list line"
							value={item.text}
							required
							save={(text) =>
								update.mutateAsync({
									payload: {
										...base,
										doneList: kept.map((line) => (line.id === item.id ? { ...line, text } : line)),
									},
								})
							}
						/>
						{list.length > 1 ? (
							<button
								type="button"
								className="ib goal-x"
								aria-label={`Remove: ${item.text}`}
								data-tip="Remove line"
								disabled={update.isPending}
								onClick={() =>
									update.mutate({ payload: { ...base, doneList: kept.filter((line) => line.id !== item.id) } })
								}
							>
								<Icon name="x" />
							</button>
						) : null}
					</li>
				))}
			</ul>
			<form
				className="done-add"
				onSubmit={(event) => {
					event.preventDefault();

					if (adding.trim() !== "") update.mutate({ payload: { ...base, doneList: [...kept, { text: adding }] } });
				}}
			>
				<Icon name="plus" />
				<input
					className="inp"
					aria-label="Add a line to the done list"
					placeholder="Add a line"
					value={adding}
					maxLength={500}
					onChange={(event) => setAdding(event.target.value)}
				/>
			</form>

			<h4 className="obj-sub">
				Work
				<span className="cnt">
					{progress === undefined ? "none yet" : `${progress.done} of ${progress.total} done`}
				</span>
				<span className="grow" />
				<Link
					to="/v/$slug/work"
					params={{ slug: venture.slug }}
					hash={`home-objective:${objective.id}`}
					className="goal-p mono"
				>
					{progress === undefined ? null : <Pips done={progress.done} total={progress.total} />}
					Open work
				</Link>
			</h4>

			{error === null ? null : (
				<p className="err" role="alert">
					{describeError(error)}
				</p>
			)}
		</div>
	);
}

function Assumptions({ venture, objective, cockpit, numbers, fresh }: CardProps) {
	const [adding, setAdding] = useState(false);
	const drafted = useDraftItem(objective.id).created;
	const mine = rankAssumptions(cockpit.assumptions.filter((assumption) => assumption.objectiveId === objective.id));

	return (
		<>
			<h4 className="obj-sub pad">
				Assumptions
				<span className="cnt">{mine.length}</span>
				<span className="cap">what must be true, weakest evidence first</span>
			</h4>
			<ul className="asms">
				{mine.map((assumption) => (
					<AssumptionRow
						key={assumption.id}
						venture={venture}
						assumption={assumption}
						cockpit={cockpit}
						numbers={numbers}
						fresh={fresh}
					/>
				))}
				{mine.length === 0 && !adding && !drafted ? (
					<li className="goals-none">
						Nothing listed yet. Work backward from the objective: what has to be true for it to be reached?
					</li>
				) : null}
			</ul>
			{drafted ? null : adding ? (
				<AssumptionForm venture={venture} objectiveId={objective.id} close={() => setAdding(false)} />
			) : (
				<button type="button" className="addline" onClick={() => setAdding(true)}>
					<Icon name="plus" />
					Add assumption
				</button>
			)}
		</>
	);
}

export function AssumptionForm(props: { venture: VentureRef; objectiveId: string | null; close: () => void }) {
	const [statement, setStatement] = useState("");
	const [impact, setImpact] = useState<Impact>("medium");
	const [fn, setFn] = useState<WorkFunction>(lastFunction);
	const hunch = props.objectiveId === null;

	const create = useLoopCommand("assumption.create", props.venture, () => {
		setStatement("");

		if (hunch) props.close();
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (statement.trim() === "") return;

		lastFunction = fn;

		create.mutate({
			payload: { ventureId: props.venture.id, objectiveId: props.objectiveId, statement, impact, function: fn },
		});
	};

	return (
		<form
			className={hunch ? "asm-add hunch" : "asm-add"}
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<input
				className="inp"
				aria-label={hunch ? "Something worth testing later" : "Assumption"}
				placeholder={hunch ? "Something you believe but haven't tested" : "One sentence that must be true"}
				value={statement}
				required
				maxLength={1000}
				ref={focusOnMount}
				onChange={(event) => setStatement(event.target.value)}
			/>
			{hunch ? null : <Select title="Impact" value={impact} options={impactOptions} onChange={setImpact} />}
			<Select title="Function" value={fn} options={functionOptions} onChange={setFn} />
			<button type="submit" className="btn pri sm" disabled={create.isPending || statement.trim() === ""}>
				Add
			</button>
			<button type="button" className="btn ghost sm" onClick={props.close}>
				Done
			</button>
			{create.isError ? (
				<p className="err" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
		</form>
	);
}

const settleOptions: { value: AssumptionStatus; label: string }[] = [
	{ value: "open", label: "Open" },
	{ value: "holds", label: "Holds" },
	{ value: "false", label: "False" },
	{ value: "dropped", label: "Dropped" },
];

function AssumptionRow(props: {
	venture: VentureRef;
	assumption: Assumption;
	cockpit: Cockpit;
	numbers: Map<string, string>;
	fresh: ReadonlySet<string>;
}) {
	const { venture, assumption, cockpit, numbers } = props;
	const [betting, setBetting] = useState(false);
	const update = useLoopCommand("assumption.update", venture);
	const archive = useLoopCommand("assumption.archive", venture);
	const base = { ventureId: venture.id, assumptionId: assumption.id };
	const closing = useStatusDrafted();
	const bets = cockpit.bets.filter((bet) => bet.assumptionId === assumption.id);
	const open = bets.filter((bet) => bet.status === "open" || closing(bet.id));

	const learnings = cockpit.learnings.filter(
		(learning) => learning.assumptionId === assumption.id && !closing(learning.betId),
	);

	const proposed = cockpit.proposedBets.filter((bet) => bet.assumptionId === assumption.id);
	const settled = assumption.status !== "open";
	const error = update.error ?? archive.error;
	const drafted = useDraftItem(assumption.id);
	const draftSave = useDraftSave(drafted);

	const className = ["asm", settled ? "settled" : "", props.fresh.has(assumption.id) ? "fresh" : "", drafted.className]
		.filter(Boolean)
		.join(" ");

	return (
		<li className={className} {...drafted.attrs}>
			<div className="asm-h">
				<Conf level={assumption.confidence} />
				<div className="goal-t">
					<b>
						<Editable
							label="assumption"
							value={assumption.statement}
							required
							save={(statement) =>
								draftSave("statement", statement, () => update.mutateAsync({ payload: { ...base, statement } }))
							}
						/>
						<Was item={drafted} field="statement" />
					</b>
					<span>
						{drafted.mark === null ? null : (
							<>
								<DraftMeta item={drafted} />
								{" · "}
							</>
						)}
						{impactNames[assumption.impact]} · {functionNames[assumption.function].toLowerCase()} ·{" "}
						{drafted.created
							? "drafted by the operator"
							: assumptionState(assumption, cockpit.bets, cockpit.learnings, cockpit.proposedBets)}
					</span>
				</div>
				{drafted.mark === null ? null : <DraftControls changes={drafted.changes} />}
				<span className="asm-ctl" hidden={drafted.mark !== null}>
					<Select
						className="sel pill"
						title="Impact if false"
						value={assumption.impact}
						options={impactOptions}
						onChange={(impact) => update.mutate({ payload: { ...base, impact } })}
					/>
					<Select
						className="sel pill"
						title="Function"
						value={assumption.function}
						options={functionOptions}
						onChange={(value) => update.mutate({ payload: { ...base, function: value } })}
					/>
					<Select
						className="sel pill"
						title="Where it stands"
						value={assumption.status}
						options={settleOptions}
						onChange={(status) => update.mutate({ payload: { ...base, status } })}
					/>
					{bets.length === 0 ? (
						<button
							type="button"
							className="ib"
							aria-label="Archive assumption"
							data-tip="Archive assumption"
							disabled={archive.isPending}
							onClick={() => archive.mutate({ payload: base })}
						>
							<Icon name="archive" />
						</button>
					) : null}
				</span>
			</div>

			{error === null ? null : (
				<p className="err asm-err" role="alert">
					{describeError(error)}
				</p>
			)}

			{open.length + proposed.length + learnings.length === 0 && !betting ? null : (
				<div className="asm-b">
					{open.map((bet) => (
						<BetBlock
							key={bet.id}
							venture={venture}
							bet={bet}
							number={numbers.get(bet.id) ?? "B"}
							assumption={assumption}
							readings={cockpit.readings}
							progress={cockpit.workProgress[workHomeKey({ betId: bet.id, objectiveId: null })]}
							fresh={props.fresh.has(bet.id)}
						/>
					))}
					{proposed.map((bet) => (
						<Link
							key={`${bet.proposalId}:${bet.action}`}
							to="/inbox"
							search={{ proposal: bet.proposalId }}
							className="betx-h waiting"
						>
							<Need />
							<span className="betx-t">
								<b>{bet.action}</b>
								<span>{actorName(bet.createdBy)} proposed this bet. Waiting for your approval</span>
							</span>
							<Icon name="chevr" />
						</Link>
					))}
					{learnings.length === 0 ? null : (
						<ul className="learneds">
							{learnings.map((learning) => (
								<LearningLine key={learning.id} learning={learning} number={numbers.get(learning.betId)} />
							))}
						</ul>
					)}
					{betting ? <BetForm venture={venture} assumption={assumption} close={() => setBetting(false)} /> : null}
				</div>
			)}

			{settled || betting || drafted.created ? null : (
				<button type="button" className="addline asm-bet" onClick={() => setBetting(true)}>
					<Icon name="plus" />
					{open.length === 0 ? "Register a bet that tests this" : "Register another bet"}
				</button>
			)}
		</li>
	);
}

function HunchRow({ id, children }: { id: string; children: ReactNode }) {
	const drafted = useDraftItem(id);

	return (
		<li className={drafted.className || undefined} {...drafted.attrs}>
			{children}
			{drafted.mark === null ? null : (
				<span className="hunch-draft cap">
					<DraftMeta item={drafted} />
					<DraftControls changes={drafted.changes} />
				</span>
			)}
		</li>
	);
}

/** Assumptions that sit under no objective yet: beliefs noted while building, to be tested later. */
export function Hunches({ venture, cockpit }: { venture: VentureRef; cockpit: Cockpit }) {
	const [adding, setAdding] = useState(false);
	const update = useLoopCommand("assumption.update", venture);
	const archive = useLoopCommand("assumption.archive", venture);
	const hunches = cockpit.assumptions.filter((assumption) => assumption.objectiveId === null);

	const climbing = cockpit.objectives.filter(
		(objective) => objective.status === "active" && objective.kind !== "build",
	);

	const error = update.error ?? archive.error;
	const now = Date.now();

	return (
		<section aria-labelledby="hunches-heading">
			<Sec title="Worth testing later" id="hunches-heading" count={hunches.length}>
				<button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
					<Icon name="plus" />
					Note
				</button>
			</Sec>
			{adding ? <AssumptionForm venture={venture} objectiveId={null} close={() => setAdding(false)} /> : null}
			{hunches.length === 0 && !adding ? (
				<p className="empty">Beliefs you haven't tested. Note them while you build; they become assumptions.</p>
			) : null}
			<ul className="hunches">
				{hunches.map((hunch) => (
					<HunchRow key={hunch.id} id={hunch.id}>
						<p>
							<Editable
								label="hunch"
								value={hunch.statement}
								required
								save={(statement) =>
									update.mutateAsync({ payload: { ventureId: venture.id, assumptionId: hunch.id, statement } })
								}
							/>
						</p>
						<span className="cap">
							Noted by {actorName(hunch.createdBy).toLowerCase()} ·{" "}
							{shortDate(hunch.createdAt.slice(0, 10), now)}
							{hunch.status === "open" ? "" : ` · ${hunch.status}`}
						</span>
						<span className="hunch-acts">
							{climbing.length === 0 ? null : (
								<Select
									className="sel pill"
									title="Test it under an objective"
									value=""
									options={[
										{ value: "", label: "Test under…" },
										...climbing.map((objective) => ({ value: objective.id, label: objective.statement })),
									]}
									onChange={(objectiveId) => {
										if (objectiveId !== "") {
											update.mutate({
												payload: { ventureId: venture.id, assumptionId: hunch.id, objectiveId },
											});
										}
									}}
								/>
							)}
							<button
								type="button"
								className="ib"
								aria-label="Archive hunch"
								data-tip="Archive"
								disabled={archive.isPending}
								onClick={() => archive.mutate({ payload: { ventureId: venture.id, assumptionId: hunch.id } })}
							>
								<Icon name="archive" />
							</button>
						</span>
					</HunchRow>
				))}
			</ul>
			{error === null ? null : (
				<p className="err" role="alert">
					{describeError(error)}
				</p>
			)}
		</section>
	);
}

export function Learnings({ cockpit }: { cockpit: Cockpit }) {
	const numbers = betNumbers(cockpit.bets);
	const recent = cockpit.learnings.slice(0, 5);

	return (
		<section aria-labelledby="learnings-heading">
			<Sec title="Learnings" id="learnings-heading" count={cockpit.learnings.length} />
			{recent.length === 0 ? (
				<p className="empty">Every closed bet leaves one sentence here.</p>
			) : (
				<ul className="learneds aside">
					{recent.map((learning) => (
						<LearningLine key={learning.id} learning={learning} number={numbers.get(learning.betId)} />
					))}
				</ul>
			)}
		</section>
	);
}

const closedWords = { met: "met", dropped: "dropped", active: "active" } as const;

export function ClosedObjectives({ objectives }: { objectives: Objective[] }) {
	if (objectives.length === 0) return null;

	return (
		<section aria-labelledby="closed-heading">
			<Sec title="Closed" id="closed-heading" count={objectives.length} />
			<ul className="closed">
				{objectives.map((objective) => (
					<li key={objective.id}>
						<Dia status={objective.status === "met" ? "done" : "lost"} />
						<b>{objective.statement}</b>
						<span className="cap">
							{kindNames[objective.kind]} · {closedWords[objective.status]}
							{objective.closedAt === null ? "" : ` ${formatDate(objective.closedAt.slice(0, 10))}`}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
