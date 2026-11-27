import type { Cockpit, HoldingRow, WorkStatus } from "@braise/core";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { plural } from "../labels.ts";
import { AppIcon, accent, Cast, Icon, type VentureTone } from "../marks.tsx";
import { ago } from "../time.ts";
import type { Working } from "../working.tsx";
import { leadObjective } from "./figures.ts";

const weekMs = 7 * 24 * 60 * 60 * 1000;

const workTones = { done: "ok", doing: "live", todo: "wait" } as const satisfies Record<WorkStatus, string>;

const workWords = { done: "done", doing: "doing", todo: "to do" } as const satisfies Record<WorkStatus, string>;

function Strip({
	tone,
	working,
	lastActivityAt,
	now,
}: {
	tone: VentureTone | null;
	working: Working | undefined;
	lastActivityAt: string;
	now: number;
}) {
	if (working !== undefined) {
		return (
			<Cast
				label={`${working.agent?.name ?? "An agent"} is on “${working.run.threadTitle}”`}
				since={working.run.startedAt ?? working.run.createdAt}
			/>
		);
	}

	if (tone === "needs") return <span className="cast idle">Waiting on you</span>;

	if (tone === "wait") return <span className="cast idle">Queued for an agent</span>;

	const quiet = now - Date.parse(lastActivityAt) > weekMs;

	return (
		<span className="cast idle">
			{quiet ? `Quiet for ${ago(lastActivityAt, now).replace(/ ago$/u, "")}` : `Active ${ago(lastActivityAt, now)}`}
		</span>
	);
}

/** A venture on the campus: who it is, why it exists, where it is heading, and what is happening in it now. */
export function VentureCard({
	row,
	cockpit,
	work,
	tone,
	working,
	now,
	hot,
	setHot,
}: {
	row: HoldingRow;
	cockpit: Cockpit | undefined;
	work: Record<WorkStatus, number>;
	tone: VentureTone | null;
	working: Working | undefined;
	now: number;
	hot: boolean;
	setHot: (slug: string | null) => void;
}) {
	const lead = cockpit === undefined ? null : leadObjective(cockpit);
	const objectives = cockpit?.objectives.filter((objective) => objective.status === "active").length ?? 0;
	const total = work.done + work.doing + work.todo;
	const statuses = (["done", "doing", "todo"] as const).filter((status) => work[status] > 0);

	return (
		<Link
			to="/v/$slug"
			params={{ slug: row.slug }}
			className={hot ? "vl-vc hot" : "vl-vc"}
			style={accent(row.slug)}
			onPointerEnter={() => setHot(row.slug)}
			onPointerLeave={() => setHot(null)}
		>
			<div className="vl-vc-h">
				<AppIcon slug={row.slug} size={52} tone={tone} />
				<div className="vl-vc-t">
					<h3>{row.name}</h3>
					<span className="cap">
						{plural(row.openBets, "bet")} · {plural(objectives, "objective")} · {total} work
					</span>
				</div>
				<span className="vl-ver">v{row.strategyVersion}</span>
			</div>
			<p className="vl-why">{cockpit === undefined ? " " : `“${cockpit.strategy.why}”`}</p>
			{lead === null ? null : (
				<div className="vl-obj">
					<span>{lead.statement}</span>
					{lead.figure === null ? null : <span className="mono">{lead.figure}</span>}
					{lead.share === null ? null : (
						<span className="vl-track">
							<i style={{ width: `${Math.round(Math.min(1, Math.max(0, lead.share)) * 100)}%` }} />
						</span>
					)}
				</div>
			)}
			{total === 0 ? null : (
				<>
					<div
						className="vl-bar"
						role="img"
						aria-label={statuses.map((status) => `${work[status]} ${workWords[status]}`).join(", ")}
					>
						{statuses.map((status) => (
							<i key={status} data-tone={workTones[status]} style={{ "--w": work[status] } as CSSProperties} />
						))}
					</div>
					<div className="vl-bar-l">
						{statuses.map((status) => (
							<span key={status}>
								<i className="vl-dot" data-tone={workTones[status]} />
								<b>{work[status]}</b> {workWords[status]}
							</span>
						))}
					</div>
				</>
			)}
			<Strip tone={tone} working={working} lastActivityAt={row.lastActivityAt} now={now} />
		</Link>
	);
}

export function BreakGround() {
	return (
		<Link to="/new" className="vl-vc vl-new">
			<span className="vl-plus">
				<Icon name="plus" />
			</span>
			<b>Break ground</b>
			<span className="cap">A new venture gets a plot in the Valley.</span>
		</Link>
	);
}
