import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api } from "./api.ts";
import { EventItem } from "./feed.tsx";
import { PageError } from "./holding.tsx";
import { keys, queries } from "./live.ts";

const pageSize = 50;

export function VentureActivityPage() {
	const { slug } = useParams({ from: "/v/$slug/activity" });
	const cockpit = useQuery(queries.cockpit(slug));

	const events = useInfiniteQuery({
		queryKey: [...keys.events(slug), "all"],
		queryFn: ({ pageParam }) => api.events(slug, pageParam, pageSize),
		initialPageParam: null as number | null,
		getNextPageParam: (last) => {
			const oldest = last.events.at(-1)?.seq ?? null;

			return last.events.length < pageSize || oldest === null || oldest <= 1 ? undefined : oldest;
		},
	});

	return (
		<>
			<header className="topbar">
				<Link to="/v/$slug" params={{ slug }} className="crumb">
					{cockpit.data?.venture.name ?? slug}
				</Link>
				<span className="muted" aria-hidden>
					/
				</span>
				<h1>Activity</h1>
			</header>
			<div className="page page-narrow">
				{events.isPending ? (
					<FeedSkeleton />
				) : events.isError ? (
					<PageError error={events.error} retry={() => void events.refetch()} />
				) : (
					<>
						<ol className="feed is-full">
							{events.data.pages
								.flatMap((page) => page.events)
								.map((event) => (
									<EventItem key={event.seq} event={event} full />
								))}
						</ol>
						{events.hasNextPage ? (
							<button
								type="button"
								className="button load-more"
								disabled={events.isFetchingNextPage}
								onClick={() => void events.fetchNextPage()}
							>
								{events.isFetchingNextPage ? "Loading…" : "Load older"}
							</button>
						) : null}
					</>
				)}
			</div>
		</>
	);
}

export function HoldingActivityPage() {
	const events = useQuery(queries.recent());

	return (
		<>
			<header className="topbar">
				<Link to="/" className="crumb">
					Holding
				</Link>
				<span className="muted" aria-hidden>
					/
				</span>
				<h1>Activity</h1>
				<span className="muted">across every venture, latest 100</span>
			</header>
			<div className="page page-narrow">
				{events.isPending ? (
					<FeedSkeleton />
				) : events.isError ? (
					<PageError error={events.error} retry={() => void events.refetch()} />
				) : events.data.events.length === 0 ? (
					<p className="empty-state">Nothing has happened yet.</p>
				) : (
					<ol className="feed is-full">
						{events.data.events.map((event) => (
							<EventItem key={`${event.ventureId}:${event.seq}`} event={event} full />
						))}
					</ol>
				)}
			</div>
		</>
	);
}

function FeedSkeleton() {
	return (
		<div className="skeleton-stack" aria-busy="true">
			<span className="visually-hidden">Loading activity…</span>
			{[80, 65, 72, 58, 70].map((width) => (
				<span key={width} className="skeleton" style={{ width: `${width}%` }} />
			))}
		</div>
	);
}
