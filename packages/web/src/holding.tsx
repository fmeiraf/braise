import type { HoldingRow } from "@braise/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useState } from "react";
import { CreateVenture } from "./create-venture.tsx";
import { describeError } from "./errors.ts";
import { kindLabel } from "./labels.ts";
import { queries } from "./live.ts";
import { VentureRings } from "./rings.tsx";
import { ago } from "./time.ts";

type SortKey = "name" | "kind" | "openBets" | "goals" | "unlinkedGoals" | "lastActivityAt";

const columns: { key: SortKey; label: string; numeric: boolean }[] = [
	{ key: "name", label: "Venture", numeric: false },
	{ key: "kind", label: "Kind", numeric: false },
	{ key: "openBets", label: "Open bets", numeric: true },
	{ key: "goals", label: "Goals", numeric: true },
	{ key: "unlinkedGoals", label: "Not tied to a bet", numeric: true },
	{ key: "lastActivityAt", label: "Last activity", numeric: true },
];

function compare(a: HoldingRow, b: HoldingRow, key: SortKey) {
	const left = a[key];
	const right = b[key];

	return typeof left === "number" && typeof right === "number"
		? left - right
		: String(left).localeCompare(String(right));
}

export function HoldingPage() {
	const ventures = useQuery(queries.ventures());
	const navigate = useNavigate();

	const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
		key: "lastActivityAt",
		descending: true,
	});

	if (ventures.isPending) return <HoldingSkeleton />;

	if (ventures.isError) return <PageError error={ventures.error} retry={() => void ventures.refetch()} />;

	if (ventures.data.ventures.length === 0) return <CreateVenture firstRun />;

	const rows = ventures.data.ventures.toSorted((a, b) => {
		const order = compare(a, b, sort.key);

		return sort.descending ? -order : order;
	});

	const now = Date.now();

	return (
		<>
			<header className="topbar">
				<h1>Holding</h1>
				<span className="muted num">{rows.length}</span>
				<div className="topbar-actions">
					<Link to="/new" className="button is-primary">
						<Plus aria-hidden />
						New venture
					</Link>
				</div>
			</header>
			<div className="page">
				<table className="table">
					<thead>
						<tr>
							{columns.map((column) => {
								const active = sort.key === column.key;

								return (
									<th
										key={column.key}
										className={column.numeric ? "is-num" : undefined}
										aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
									>
										<button
											type="button"
											onClick={() =>
												setSort({ key: column.key, descending: active ? !sort.descending : column.numeric })
											}
										>
											{column.label}
											{active ? sort.descending ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden /> : null}
										</button>
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} onClick={() => void navigate({ to: "/v/$slug", params: { slug: row.slug } })}>
								<td>
									<Link to="/v/$slug" params={{ slug: row.slug }} className="venture-cell">
										<VentureRings id={row.id} live={false} quiet={false} />
										{row.name}
									</Link>
								</td>
								<td className="muted">{kindLabel[row.kind]}</td>
								<td className="is-num">{row.openBets}</td>
								<td className="is-num">{row.goals}</td>
								<td className="is-num">
									{row.unlinkedGoals > 0 ? (
										<span className="flagged" title="Goals that test no bet">
											<span className="pixel" aria-hidden />
											{row.unlinkedGoals}
										</span>
									) : (
										<span className="muted">0</span>
									)}
								</td>
								<td className="is-num muted" title={row.lastActivityAt}>
									{ago(row.lastActivityAt, now)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

function HoldingSkeleton() {
	return (
		<>
			<header className="topbar">
				<h1>Holding</h1>
			</header>
			<div className="page skeleton-stack" aria-busy="true">
				<span className="visually-hidden">Loading ventures…</span>
				{[72, 64, 80, 56].map((width) => (
					<span key={width} className="skeleton" style={{ width: `${width}%` }} />
				))}
			</div>
		</>
	);
}

export function PageError({ error, retry }: { error: unknown; retry: () => void }) {
	return (
		<div className="page-error" role="alert">
			<p>{describeError(error)}</p>
			<button type="button" className="button" onClick={retry}>
				Try again
			</button>
		</div>
	);
}
