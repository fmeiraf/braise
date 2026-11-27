import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CreateVenture } from "./create-venture.tsx";
import { describeError } from "./errors.ts";
import { NeedsYou } from "./inbox.tsx";
import { queries } from "./live.ts";
import { HoldingIcon, IconTile } from "./marks.tsx";
import { Sec, Skeleton } from "./parts.tsx";
import { ago } from "./time.ts";
import { BreakGround, VentureCard } from "./valley/campus.tsx";
import { City } from "./valley/city.tsx";
import { doneThisWeek, weekAgo, workCounts } from "./valley/figures.ts";
import { Attention, Kicker, Legend, Sky } from "./valley/hero.tsx";
import { plan } from "./valley/layout.ts";
import { OnShift } from "./valley/on-shift.tsx";
import { useVentureTones, useWorking } from "./working.tsx";

function Stat({
	icon,
	label,
	value,
	note,
	need = false,
}: {
	icon: React.ReactNode;
	label: string;
	value: number;
	note: string;
	need?: boolean;
}) {
	return (
		<div className={need ? "vl-stat vl-need" : "vl-stat"}>
			{icon}
			<div>
				<div className="vl-stat-k">{label}</div>
				<div className="vl-stat-v">
					{value}
					<small>{note}</small>
				</div>
			</div>
		</div>
	);
}

function shiftLine(ventures: number, runs: number) {
	if (ventures > 0) return ventures === 1 ? "1 venture on shift." : `${ventures} ventures on shift.`;

	if (runs > 0) return runs === 1 ? "1 agent on shift at the Holding." : `${runs} agents on shift at the Holding.`;

	return "Nobody is on shift.";
}

export function HoldingPage() {
	const ventures = useQuery(queries.ventures());
	const inbox = useQuery(queries.inbox());
	const agents = useQuery(queries.agents());
	const work = useQuery(queries.holdingWork());
	const working = useWorking();
	const toneOf = useVentureTones();
	const [hot, setHot] = useState<string | null>(null);

	const cockpits = useQueries({
		queries: (ventures.data?.ventures ?? []).map((venture) => queries.cockpit(venture.slug)),
	});

	const [since] = useState(() => weekAgo(Date.now()));

	const weeks = useQueries({
		queries: (ventures.data?.ventures ?? []).map((venture) => queries.week(venture.slug, since)),
	});

	if (ventures.isPending) {
		return (
			<div className="page">
				<Skeleton label="Loading the Valley…" widths={[72, 64, 80, 56]} />
			</div>
		);
	}

	if (ventures.isError) return <PageError error={ventures.error} retry={() => void ventures.refetch()} />;

	if (ventures.data.ventures.length === 0) return <CreateVenture firstRun />;

	const now = Date.now();
	const rows = ventures.data.ventures.toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
	const pending = inbox.data?.pending ?? [];
	const items = work.data?.workItems ?? [];
	const onShift = new Set(working.map((item) => item.run.ventureSlug).filter((slug) => slug !== null)).size;
	const agentsOnShift = new Set(working.map((item) => item.agent?.id ?? item.run.id)).size;

	const oldestNeed = pending
		.map((item) => (item.kind === "draft" ? item.latestChangeAt : item.createdAt))
		.toSorted()
		.at(0);

	return (
		<div className="valley">
			<section className="vl-hero">
				<Sky />
				<City
					layout={plan(ventures.data.ventures)}
					ventures={ventures.data.ventures}
					toneOf={toneOf}
					hot={hot}
					setHot={setHot}
				/>
				<div className="vl-hud">
					<Kicker>The Holding</Kicker>
					<h1 className="vl-h1">The Valley never sleeps.</h1>
					<p className="vl-h2">{shiftLine(onShift, working.length)}</p>
					<Attention count={pending.length} />
				</div>
				<Legend />
			</section>
			<section className="vl-sheet">
				<div className="vl-page">
					<div className="vl-stats">
						<Stat icon={<HoldingIcon size={46} />} label="Ventures" value={rows.length} note="on the campus" />
						<Stat
							icon={<IconTile name="agents" hue="var(--holding)" light="var(--holding-light)" size={46} />}
							label="On shift"
							value={agentsOnShift}
							note={`of ${agents.data?.agents.length ?? 0} agents`}
						/>
						<Stat
							icon={<IconTile name="inbox" hue="var(--beacon)" light="var(--beacon-light)" size={46} />}
							label="Needs you"
							value={pending.length}
							note={
								oldestNeed === undefined ? "all clear" : `oldest ${ago(oldestNeed, now).replace(/ ago$/u, "")}`
							}
							need={pending.length > 0}
						/>
						<Stat
							icon={<IconTile name="work" hue="var(--ok)" light="var(--ok-light)" size={46} />}
							label="Work done"
							value={doneThisWeek(
								weeks.flatMap((week) => week.data ?? []),
								items,
								now,
							)}
							note="this week"
						/>
					</div>
					<div className="vl-cols">
						<section aria-labelledby="campus-heading">
							<Sec title="The campus" id="campus-heading" count={rows.length} />
							<div className="vl-campus">
								{rows.map((row) => (
									<VentureCard
										key={row.id}
										row={row}
										cockpit={cockpits[ventures.data.ventures.indexOf(row)]?.data}
										work={workCounts(items, row.id)}
										tone={toneOf(row)}
										working={working.find((item) => item.run.ventureSlug === row.slug)}
										now={now}
										hot={hot === row.slug}
										setHot={setHot}
									/>
								))}
								<BreakGround />
							</div>
						</section>
						<aside className="vl-aside">
							<NeedsYou />
							<section aria-labelledby="shift-heading">
								<Sec title="On shift" id="shift-heading" count={working.length} />
								<OnShift working={working} />
							</section>
						</aside>
					</div>
				</div>
			</section>
		</div>
	);
}

export function PageError({ error, retry }: { error: unknown; retry: () => void }) {
	return (
		<div className="page-error" role="alert">
			<p>{describeError(error)}</p>
			<button type="button" className="btn" onClick={retry}>
				Try again
			</button>
		</div>
	);
}
