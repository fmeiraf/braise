import type { Cockpit, HoldingRow } from "@braise/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CreateVenture } from "./create-venture.tsx";
import { describeError } from "./errors.ts";
import { kindLabel } from "./labels.ts";
import { queries } from "./live.ts";
import { accent, Cast, Crest, Icon } from "./marks.tsx";
import { Hero, Sec, Skeleton } from "./parts.tsx";
import { ago } from "./time.ts";
import { useWorking, workingLabel } from "./working.tsx";

type SortKey = "name" | "strategyVersion" | "openBets" | "openAssumptions" | "workDone" | "lastActivityAt";

const columns: { key: SortKey; label: string; numeric: boolean }[] = [
	{ key: "name", label: "Venture", numeric: false },
	{ key: "strategyVersion", label: "Strategy", numeric: true },
	{ key: "openBets", label: "Open bets", numeric: true },
	{ key: "openAssumptions", label: "Open assumptions", numeric: true },
	{ key: "workDone", label: "Work done", numeric: true },
	{ key: "lastActivityAt", label: "Last activity", numeric: true },
];

const weekMs = 7 * 24 * 60 * 60 * 1000;

interface LedgerRow extends HoldingRow {
	what: string | null;
	work: { done: number; total: number } | null;
	workDone: number;
}

function workOf(cockpit: Cockpit | undefined) {
	if (cockpit === undefined) return null;

	const all = Object.values(cockpit.workProgress);

	return {
		done: all.reduce((sum, progress) => sum + progress.done, 0),
		total: all.reduce((sum, progress) => sum + progress.total, 0),
	};
}

function compare(a: LedgerRow, b: LedgerRow, key: SortKey) {
	const left = a[key];
	const right = b[key];

	return typeof left === "number" && typeof right === "number"
		? left - right
		: String(left).localeCompare(String(right));
}

export function HoldingPage() {
	const ventures = useQuery(queries.ventures());
	const working = useWorking();
	const navigate = useNavigate();

	const cockpits = useQueries({
		queries: (ventures.data?.ventures ?? []).map((venture) => queries.cockpit(venture.slug)),
	});

	const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
		key: "lastActivityAt",
		descending: true,
	});

	if (ventures.isPending) {
		return (
			<div className="page">
				<Hero cap="Holding" title="Your ventures" />
				<Skeleton label="Loading ventures…" widths={[72, 64, 80, 56]} />
			</div>
		);
	}

	if (ventures.isError) return <PageError error={ventures.error} retry={() => void ventures.refetch()} />;

	if (ventures.data.ventures.length === 0) return <CreateVenture firstRun />;

	const ledger = ventures.data.ventures.map((venture, index) => {
		const cockpit = cockpits[index]?.data;
		const work = workOf(cockpit);

		return { ...venture, what: cockpit?.strategy.what ?? null, work, workDone: work?.done ?? 0 } satisfies LedgerRow;
	});

	const rows = ledger.toSorted((a, b) => {
		const order = compare(a, b, sort.key);

		return sort.descending ? -order : order;
	});

	const now = Date.now();
	const liveIn = (slug: string) => working.find((item) => item.run.ventureSlug === slug);
	const byActivity = ledger.toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

	return (
		<div className="page">
			<Hero
				cap={`Holding · ${ledger.length === 1 ? "1 venture" : `${ledger.length} ventures`}`}
				title="Your ventures"
			/>
			<ul className="vcs">
				{byActivity.map((row) => {
					const live = liveIn(row.slug);
					const quiet = now - Date.parse(row.lastActivityAt) > weekMs;

					return (
						<li key={row.id}>
							<Link to="/v/$slug" params={{ slug: row.slug }} className="vc" style={accent(row.slug)}>
								<div className="vc-top">
									<Crest seed={row.slug} size={44} live={live !== undefined} />
									<span className="cap">{kindLabel[row.kind]}</span>
								</div>
								<h3>{row.name}</h3>
								<p>{row.what}</p>
								<div className="vc-foot">
									{live === undefined ? (
										<span className="cap">
											{quiet
												? `Quiet for ${ago(row.lastActivityAt, now).replace(/ ago$/u, "")}`
												: `Active ${ago(row.lastActivityAt, now)}`}
										</span>
									) : (
										<Cast label={workingLabel(live)} since={live.run.startedAt ?? live.run.createdAt} />
									)}
								</div>
							</Link>
						</li>
					);
				})}
				<li>
					<Link to="/new" className="vc slot-empty">
						<span className="plus">
							<Icon name="plus" />
						</span>
						<span className="cap">New venture</span>
					</Link>
				</li>
			</ul>

			<Sec title="Ledger" />
			<table className="tbl">
				<thead>
					<tr>
						{columns.map((column) => {
							const active = sort.key === column.key;

							return (
								<th
									key={column.key}
									className={column.numeric ? "r" : undefined}
									aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
								>
									<button
										type="button"
										onClick={() =>
											setSort({ key: column.key, descending: active ? !sort.descending : column.numeric })
										}
									>
										{column.label}
										{active ? <Icon name={sort.descending ? "down" : "up"} /> : null}
									</button>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.id}
							style={accent(row.slug)}
							onClick={() => void navigate({ to: "/v/$slug", params: { slug: row.slug } })}
						>
							<td>
								<Link to="/v/$slug" params={{ slug: row.slug }} className="vcell">
									<Crest seed={row.slug} size={16} live={liveIn(row.slug) !== undefined} />
									{row.name}
									{liveIn(row.slug) === undefined ? null : <span className="tag live">Working</span>}
								</Link>
							</td>
							<td className="r">v{row.strategyVersion}</td>
							<td className="r">{row.openBets}</td>
							<td className="r">
								{row.openAssumptions > 0 ? row.openAssumptions : <span className="dim">0</span>}
							</td>
							<td className="r">
								{row.work === null || row.work.total === 0 ? (
									<span className="dim">–</span>
								) : (
									`${row.work.done}/${row.work.total}`
								)}
							</td>
							<td className="r mute" title={row.lastActivityAt}>
								{ago(row.lastActivityAt, now)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
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
