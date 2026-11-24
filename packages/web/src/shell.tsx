import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { Activity, CircleDot, Inbox, Layers, PanelsTopLeft, Plus } from "lucide-react";
import wordmark from "../../../assets/svg/braise-exe-wordmark-light.svg";
import { useFreshVentures } from "./fresh.ts";
import { queries, rememberVenture, useHintStream } from "./live.ts";

const dayMs = 24 * 60 * 60 * 1000;

export function Shell() {
	const client = useQueryClient();
	const stream = useHintStream(client);
	const ventures = useQuery(queries.ventures());
	const fresh = useFreshVentures();
	const { slug } = useParams({ strict: false });
	const now = Date.now();

	for (const venture of ventures.data?.ventures ?? []) rememberVenture(venture.id, venture.slug, venture.lastSeq);

	const scopeSlug = slug ?? null;
	const overviewPath = scopeSlug === null ? "/" : `/v/${scopeSlug}`;
	const activityPath = scopeSlug === null ? "/activity" : `/v/${scopeSlug}/activity`;

	return (
		<div className="shell">
			<nav className="rail" aria-label="Main">
				<Link to="/" className="rail-brand" aria-label="braise.exe, Holding">
					<img src={wordmark} alt="" width={150} height={28} />
				</Link>

				<div className="rail-section">
					<span className="rail-item" aria-disabled="true" title="The inbox arrives with agent proposals">
						<Inbox aria-hidden />
						<span className="rail-label">Inbox</span>
						<span className="rail-count">soon</span>
					</span>
					<span className="rail-item" aria-disabled="true" title="Live agent runs arrive with threads">
						<CircleDot aria-hidden />
						<span className="rail-label">No runs</span>
					</span>
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

						const pixelClass = [
							"pixel",
							recent ? "is-active" : "is-quiet",
							fresh.has(venture.id) ? "is-simmering" : "",
						].join(" ");

						return (
							<Link
								key={venture.id}
								to="/v/$slug"
								params={{ slug: venture.slug }}
								className={venture.slug === scopeSlug ? "rail-item is-scope" : "rail-item"}
								title={recent ? `${venture.name}: active today` : venture.name}
							>
								<span className={pixelClass} aria-hidden />
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
