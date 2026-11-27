import { useQuery } from "@tanstack/react-query";
import { queries } from "../live.ts";
import { accent, Drone, Elapsed, Icon, isSquare } from "../marks.tsx";
import { useThreadStream } from "../thread-stream.ts";
import { describeCall, liveTail, runSegments } from "../thread-timeline.ts";
import { ThreadLink, type Working } from "../working.tsx";

const shownSteps = 3;

function Trace({ working }: { working: Working }) {
	const detail = useQuery(queries.thread(working.run.threadId));
	const { live } = useThreadStream(working.run.threadId);
	const run = detail.data?.runs.find((candidate) => candidate.id === working.run.id);

	if (run === undefined) return <p className="vl-trace-wait cap">Reading the thread…</p>;

	const segments = runSegments(run.events);
	const calls = segments.flatMap((segment) => (segment.kind === "tools" ? segment.calls : [])).slice(-shownSteps);
	const tail = liveTail(live, run, segments);
	const saved = segments.findLast((segment) => segment.kind === "text");
	const text = tail?.text ?? (saved?.kind === "text" ? saved.text : "");

	return (
		<ol className="vl-trace">
			{calls.map((call) => {
				const step = describeCall(call);

				return (
					<li key={call.id}>
						<span className={call.result === null ? "nub live" : call.result.isError ? "nub bad" : "nub ok"}>
							<Icon name={call.result === null ? "bolt" : call.result.isError ? "x" : "check"} />
						</span>
						<span className="vl-step">
							{step.action}
							{step.detail === null ? null : <span className="cap"> · {step.detail}</span>}
						</span>
					</li>
				);
			})}
			<li>
				<span className="nub live">
					<Icon name="bolt" />
				</span>
				<span className="vl-say">
					{text === "" ? "Thinking…" : text.slice(-280)}
					<i className="vl-caret" />
				</span>
			</li>
		</ol>
	);
}

/** The agent working longest right now, with its last few steps and what it is writing. */
export function OnShift({ working }: { working: readonly Working[] }) {
	const oldest = working.toSorted((a, b) =>
		(a.run.startedAt ?? a.run.createdAt).localeCompare(b.run.startedAt ?? b.run.createdAt),
	)[0];

	if (oldest === undefined) return <p className="empty">No agent is on shift.</p>;

	return (
		<div className="vl-shift" style={accent(oldest.run.ventureSlug)}>
			<ThreadLink ventureSlug={oldest.run.ventureSlug} threadId={oldest.run.threadId} className="vl-shift-h">
				<Drone square={isSquare(oldest.agent ?? undefined)} size={18} run />
				<span className="vl-shift-t">{oldest.run.threadTitle}</span>
				<Elapsed since={oldest.run.startedAt ?? oldest.run.createdAt} />
			</ThreadLink>
			<Trace working={oldest} />
		</div>
	);
}
