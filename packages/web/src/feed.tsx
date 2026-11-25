import { type DomainEvent, isAgentActor } from "@braise/core";
import { Link } from "@tanstack/react-router";
import { labelEvent } from "./labels.ts";
import { accent, Drone, isSquare, You } from "./marks.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, clockTime, formatDateTime } from "./time.ts";
import { useAgentLookup } from "./working.tsx";

interface FeedEvent extends DomainEvent {
	ventureSlug?: string;
	ventureName?: string;
}

function appliedByProposal(event: Pick<DomainEvent, "type" | "payload">) {
	return typeof event.payload.proposalId === "string" && !event.type.startsWith("proposal.");
}

export function EventItem({
	event,
	slug,
	fresh = false,
	full = false,
}: {
	event: FeedEvent;
	slug?: string;
	fresh?: boolean;
	full?: boolean;
}) {
	const label = labelEvent(event);
	const agentOf = useAgentLookup();
	const agent = isAgentActor(event.actor);
	const inHolding = full && event.ventureSlug !== undefined;
	const reason = event.reason === null || appliedByProposal(event) ? null : event.reason;

	return (
		<li className={fresh ? "ev fresh" : "ev"} style={accent(event.ventureSlug ?? slug)}>
			{full ? (
				<time className="mono" dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
					{clockTime(event.createdAt)}
				</time>
			) : null}
			<span className="ev-g">
				{agent ? <Drone size={14} square={isSquare(agentOf(event.actor))} /> : <You size={14} />}
			</span>
			<div>
				<p>
					<b>{actorName(event.actor)}</b> {label.action}
					{label.subject === null ? null : (
						<>
							{" "}
							<span className="obj">{label.subject}</span>
						</>
					)}
				</p>
				{label.detail === null && !inHolding ? null : (
					<p className="d">
						{event.ventureSlug === undefined || !inHolding ? null : (
							<Link to="/v/$slug" params={{ slug: event.ventureSlug }}>
								<i className="vdot" />
								{event.ventureName}
							</Link>
						)}
						{inHolding && label.detail !== null ? " · " : null}
						{label.detail}
					</p>
				)}
				{reason === null ? null : <p className="why">{reason}</p>}
			</div>
			{full ? (
				<span className="mono ev-seq">#{event.seq}</span>
			) : (
				<time className="mono" dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
					{ago(event.createdAt, Date.now())}
				</time>
			)}
		</li>
	);
}
