import type { DomainEvent } from "@braise/core";
import { Link } from "@tanstack/react-router";
import { labelEvent } from "./labels.ts";
import { ago, formatDateTime } from "./time.ts";

interface FeedEvent extends DomainEvent {
	ventureSlug?: string;
	ventureName?: string;
}

export function EventItem({
	event,
	fresh = false,
	full = false,
}: {
	event: FeedEvent;
	fresh?: boolean;
	full?: boolean;
}) {
	const label = labelEvent(event);

	return (
		<li className={fresh ? "feed-item is-fresh" : "feed-item"}>
			<span className="pixel" aria-hidden />
			<div>
				<p className="feed-text">
					<strong>{event.actor}</strong> {label.action}
					{label.subject === null ? null : (
						<>
							{" "}
							<strong>{label.subject}</strong>
						</>
					)}
					{full && event.ventureSlug !== undefined ? (
						<>
							{" "}
							in{" "}
							<Link to="/v/$slug" params={{ slug: event.ventureSlug }}>
								<strong>{event.ventureName}</strong>
							</Link>
						</>
					) : null}
				</p>
				{label.detail === null ? null : <p className="feed-detail">{label.detail}</p>}
				{event.reason === null ? null : <p className="feed-reason">{event.reason}</p>}
				{full ? null : (
					<p className="feed-meta">
						<time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
							{ago(event.createdAt, Date.now())}
						</time>
					</p>
				)}
			</div>
			{full ? (
				<span className="feed-when">
					<time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
					<span className="data"> · #{event.seq}</span>
				</span>
			) : null}
		</li>
	);
}
