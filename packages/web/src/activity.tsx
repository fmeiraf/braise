import type { DomainEvent } from "@braise/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Fragment } from "react";
import { api } from "./api.ts";
import { EventItem } from "./feed.tsx";
import { PageError } from "./holding.tsx";
import { keys, queries } from "./live.ts";
import { Hero, Skeleton } from "./parts.tsx";
import { dayLabel } from "./time.ts";

const pageSize = 50;

function DayLog<Event extends DomainEvent>({ events, slug }: { events: readonly Event[]; slug?: string }) {
	const now = Date.now();

	return (
		<ol className="log full">
			{events.map((event, index) => {
				const day = dayLabel(event.createdAt, now);
				const previous = events[index - 1];
				const first = previous === undefined || dayLabel(previous.createdAt, now) !== day;

				return (
					<Fragment key={`${event.ventureId}:${event.seq}`}>
						{first ? (
							<li className="day">
								<span className="cap">{day}</span>
							</li>
						) : null}
						<EventItem event={event} slug={slug} full />
					</Fragment>
				);
			})}
		</ol>
	);
}

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

	const loaded = events.data?.pages.flatMap((page) => page.events) ?? [];
	const name = cockpit.data?.venture.name ?? slug;

	return (
		<div className="page narrow">
			<Hero cap={events.isSuccess ? `${name} · latest ${loaded.length}` : name} title="Activity" />
			{events.isPending ? (
				<Skeleton label="Loading activity…" widths={[80, 65, 72, 58, 70]} />
			) : events.isError ? (
				<PageError error={events.error} retry={() => void events.refetch()} />
			) : (
				<>
					<DayLog events={loaded} slug={slug} />
					{events.hasNextPage ? (
						<p className="more">
							<button
								type="button"
								className="btn"
								disabled={events.isFetchingNextPage}
								onClick={() => void events.fetchNextPage()}
							>
								{events.isFetchingNextPage ? "Loading…" : "Load older"}
							</button>
						</p>
					) : null}
				</>
			)}
		</div>
	);
}

export function HoldingActivityPage() {
	const events = useQuery(queries.recent());

	return (
		<div className="page narrow">
			<Hero
				cap={
					events.isSuccess ? `Across every venture · latest ${events.data.events.length}` : "Across every venture"
				}
				title="Activity"
			/>
			{events.isPending ? (
				<Skeleton label="Loading activity…" widths={[80, 65, 72, 58, 70]} />
			) : events.isError ? (
				<PageError error={events.error} retry={() => void events.refetch()} />
			) : events.data.events.length === 0 ? (
				<p className="empty">Nothing has happened yet.</p>
			) : (
				<DayLog events={events.data.events} />
			)}
		</div>
	);
}
