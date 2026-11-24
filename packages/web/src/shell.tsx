import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { Activity, CircleDot, Inbox, Layers, ListTree, MessagesSquare, PanelsTopLeft, Plus } from "lucide-react";
import { useFreshVentures } from "./fresh.ts";
import { queries, rememberVenture, useHintStream } from "./live.ts";
import { BraiseMark, VentureRings } from "./rings.tsx";

const dayMs = 24 * 60 * 60 * 1000;

export function Shell() {
	const client = useQueryClient();
	const stream = useHintStream(client);
	const ventures = useQuery(queries.ventures());
	const activeRuns = useQuery(queries.activeRuns());
	const inbox = useQuery(queries.inbox());
	const waiting = inbox.data?.pending.length ?? 0;
	const fresh = useFreshVentures();
	const { slug } = useParams({ strict: false });
	const now = Date.now();

	for (const venture of ventures.data?.ventures ?? []) rememberVenture(venture.id, venture.slug, venture.lastSeq);

	const scopeSlug = slug ?? null;
	const overviewPath = scopeSlug === null ? "/" : `/v/${scopeSlug}`;
	const activityPath = scopeSlug === null ? "/activity" : `/v/${scopeSlug}/activity`;
	const workPath = scopeSlug === null ? "/work" : `/v/${scopeSlug}/work`;
	const threadsPath = scopeSlug === null ? "/threads" : `/v/${scopeSlug}/threads`;
	const runs = activeRuns.data?.runs ?? [];
	const oldestRun = runs[0];
	const navigate = useNavigate();

	const runHref =
		oldestRun === undefined
			? null
			: `${oldestRun.ventureSlug === null ? "" : `/v/${encodeURIComponent(oldestRun.ventureSlug)}`}/threads?thread=${encodeURIComponent(oldestRun.threadId)}`;

	return (
		<div className="shell">
			<nav className="rail" aria-label="Main">
				<Link to="/" className="rail-brand" aria-label="braise, Holding">
					<BraiseMark size={30} live={runs.length > 0} />
					<span className="rail-wordmark">braise</span>
				</Link>

				<div className="rail-section">
					<Link
						to="/inbox"
						className="rail-item"
						title={waiting === 0 ? "Nothing needs you" : `${waiting} waiting for your decision`}
					>
						<Inbox aria-hidden />
						<span className="rail-label">Inbox</span>
						{waiting === 0 ? null : <span className="rail-count is-waiting">{waiting}</span>}
					</Link>
					{oldestRun === undefined ? (
						<span className="rail-item" aria-disabled="true" title="No agent is working right now">
							<CircleDot aria-hidden />
							<span className="rail-label">No runs</span>
						</span>
					) : (
						<a
							href={runHref ?? undefined}
							className="rail-item is-running"
							title={`Claude is working on “${oldestRun.threadTitle}”`}
							onClick={(event) => {
								if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

								event.preventDefault();

								if (runHref !== null) void navigate({ href: runHref });
							}}
						>
							<span className="rail-run-mark" aria-hidden>
								<span className="pixel is-live" />
							</span>
							<span className="rail-label">{runs.length} running</span>
						</a>
					)}
				</div>

				<div className="rail-divider" />

				<div className="rail-section">
					<Link
						to="/"
						className={scopeSlug === null ? "rail-item is-scope" : "rail-item"}
						activeOptions={{ exact: true }}
					>
						<Layers aria-hidden />
						<span className="rail-label">Holding</span>
					</Link>
					<div className="rail-heading">
						<span>Ventures</span>
						<Link to="/new" className="rail-add" aria-label="New venture" title="New venture">
							<Plus aria-hidden />
						</Link>
					</div>
					{(ventures.data?.ventures ?? []).map((venture) => {
						const recent = now - Date.parse(venture.lastActivityAt) < dayMs;

						const live = runs.some((run) => run.ventureSlug === venture.slug);

						return (
							<Link
								key={venture.id}
								to="/v/$slug"
								params={{ slug: venture.slug }}
								className={venture.slug === scopeSlug ? "rail-item is-scope" : "rail-item"}
								title={
									live
										? `${venture.name}: an agent is working`
										: recent
											? `${venture.name}: active today`
											: venture.name
								}
							>
								<span className={fresh.has(venture.id) ? "rail-rings is-simmering" : "rail-rings"}>
									<VentureRings
										id={venture.id}
										version={venture.strategyVersion}
										live={live}
										quiet={!recent && !live}
									/>
								</span>
								<span className="rail-label">{venture.name}</span>
							</Link>
						);
					})}
				</div>

				<div className="rail-divider" />

				<div className="rail-section">
					<Link to={overviewPath} className="rail-item" activeOptions={{ exact: true }}>
						<PanelsTopLeft aria-hidden />
						<span className="rail-label">Overview</span>
					</Link>
					<Link to={workPath} className="rail-item" activeOptions={{ exact: true, includeSearch: false }}>
						<ListTree aria-hidden />
						<span className="rail-label">Work</span>
					</Link>
					<Link to={threadsPath} className="rail-item" activeOptions={{ exact: true, includeSearch: false }}>
						<MessagesSquare aria-hidden />
						<span className="rail-label">Threads</span>
					</Link>
					<Link to={activityPath} className="rail-item" activeOptions={{ exact: true }}>
						<Activity aria-hidden />
						<span className="rail-label">Activity</span>
					</Link>
				</div>

				{stream === "down" ? (
					<output className="rail-foot reconnect">
						<span className="pixel" aria-hidden />
						Reconnecting to live updates…
					</output>
				) : null}
			</nav>

			<main className="main">
				<Outlet />
			</main>
		</div>
	);
}
