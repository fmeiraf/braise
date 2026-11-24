import type {
	betStatuses,
	ProposableCommand,
	proposalStatuses,
	runStatuses,
	threadLinkTypes,
	ventureKinds,
	workFunctions,
	workPriorities,
	workStatuses,
} from "./commands.ts";

export type VentureKind = (typeof ventureKinds)[number];

export type BetStatus = (typeof betStatuses)[number];

export type WorkStatus = (typeof workStatuses)[number];

export type WorkFunction = (typeof workFunctions)[number];

export type WorkPriority = (typeof workPriorities)[number];

export type StrategyStatus = "draft" | "active" | "superseded";

export type ThreadLinkType = (typeof threadLinkTypes)[number];

export type RunStatus = (typeof runStatuses)[number];

export type ProposalStatus = (typeof proposalStatuses)[number];

export interface Venture {
	id: string;
	slug: string;
	name: string;
	kind: VentureKind;
	lastSeq: number;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface StrategyVersion {
	id: string;
	ventureId: string;
	version: number;
	status: StrategyStatus;
	why: string;
	what: string;
	diagnosis: string;
	guidingPolicy: string;
	createdBy: string;
	createdAt: string;
	activatedAt: string | null;
	reason: string | null;
}

export interface Bet {
	id: string;
	ventureId: string;
	hypothesis: string;
	action: string;
	killCriteria: string;
	status: BetStatus;
	introducedIn: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface Goal {
	id: string;
	ventureId: string;
	betId: string | null;
	outcome: string;
	signal: string;
	horizon: string | null;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface WorkItem {
	id: string;
	ventureId: string;
	goalId: string;
	parentId: string | null;
	depth: number;
	position: number;
	title: string;
	description: string;
	status: WorkStatus;
	function: WorkFunction;
	priority: WorkPriority;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface WorkProgress {
	done: number;
	total: number;
}

export interface VentureWork {
	ventureId: string;
	lastSeq: number;
	goals: Goal[];
	workItems: WorkItem[];
}

export interface HoldingWork {
	ventures: { id: string; slug: string; name: string; lastSeq: number }[];
	goals: Goal[];
	workItems: WorkItem[];
}

export interface HoldingRow {
	id: string;
	slug: string;
	name: string;
	kind: VentureKind;
	openBets: number;
	goals: number;
	unlinkedGoals: number;
	strategyVersion: number;
	lastSeq: number;
	lastActivityAt: string;
}

export interface Cockpit {
	venture: Venture;
	strategy: StrategyVersion;
	bets: Bet[];
	goals: Goal[];
	workProgress: Record<string, WorkProgress>;
}

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

export interface DomainEvent {
	ventureId: string;
	seq: number;
	type: string;
	subject: string;
	payload: Record<string, unknown>;
	actor: string;
	reason: string | null;
	runId: string | null;
	createdAt: string;
}

export interface CommandResponse<Result = unknown> {
	result: Result;
	seq: number;
}

export const errorCodes = [
	"validation_failed",
	"not_found",
	"idempotency_conflict",
	"rule_violated",
	"not_granted",
	"internal_error",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ApiError {
	error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}

export interface StreamHint {
	ventureId: string;
	seq: number;
}

export interface ThreadHint {
	threadId: string;
	ventureId: string | null;
}

export interface RunDelta {
	threadId: string;
	runId: string;
	block: number;
	offset: number;
	text: string;
}

export interface Thread {
	id: string;
	ventureId: string | null;
	title: string;
	lastSeq: number;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface ThreadLink {
	type: ThreadLinkType;
	id: string;
	label: string;
	ventureId: string;
	ventureSlug: string;
	ventureName: string;
	archived: boolean;
}

export interface ThreadMessage {
	id: string;
	threadId: string;
	seq: number;
	author: string;
	runId: string | null;
	body: string;
	createdAt: string;
}

export interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	durationMs: number;
	turns: number;
}

export interface Run {
	id: string;
	threadId: string;
	messageId: string;
	retryOf: string | null;
	runtime: string;
	model: string;
	actor: string;
	status: RunStatus;
	error: { message: string } | null;
	usage: RunUsage | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	cancelRequestedAt: string | null;
}

export type RunEventPayload =
	| { type: "run.started"; payload: { model: string } }
	| { type: "message"; payload: { block: number; text: string; partial?: boolean } }
	| { type: "tool.call"; payload: { toolUseId: string; name: string; input: unknown } }
	| { type: "tool.result"; payload: { toolUseId: string; output: string; isError: boolean } }
	| { type: "run.finished"; payload: { status: RunStatus } };

export type RunEvent = RunEventPayload & { runId: string; seq: number; createdAt: string };

export interface ThreadSummary extends Thread {
	links: ThreadLink[];
	lastMessage: { author: string; body: string; createdAt: string } | null;
	activeRun: { id: string; status: RunStatus } | null;
}

export interface ThreadDetail {
	thread: Thread;
	venture: { id: string; slug: string; name: string } | null;
	links: ThreadLink[];
	messages: ThreadMessage[];
	runs: (Run & { events: RunEvent[] })[];
}

export interface ActiveRun {
	id: string;
	threadId: string;
	threadTitle: string;
	ventureSlug: string | null;
	status: RunStatus;
	createdAt: string;
	startedAt: string | null;
}

export interface LinkTarget {
	type: ThreadLinkType;
	id: string;
	label: string;
	detail: string;
	ventureId: string;
	ventureSlug: string;
	ventureName: string;
}

export type ChangeBase = { strategyVersion: number } | { updatedAt: string } | null;

export interface ProposalChange {
	command: ProposableCommand;
	payload: Record<string, unknown>;
	base: ChangeBase;
}

export interface AppliedChange {
	command: ProposableCommand;
	payload: Record<string, unknown>;
}

export interface Proposal {
	id: string;
	ventureId: string;
	threadId: string;
	runId: string;
	createdBy: string;
	title: string;
	reason: string;
	changes: ProposalChange[];
	status: ProposalStatus;
	applied: (AppliedChange | null)[] | null;
	note: string | null;
	createdAt: string;
	decidedAt: string | null;
}

export interface InboxProposal {
	id: string;
	venture: { id: string; slug: string; name: string };
	thread: { id: string; title: string };
	title: string;
	createdBy: string;
	status: ProposalStatus;
	changeCount: number;
	staleCount: number;
	createdAt: string;
	decidedAt: string | null;
}

export interface Inbox {
	pending: InboxProposal[];
	decided: InboxProposal[];
}

export interface ProposalChangeDetail extends ProposalChange {
	current: Record<string, unknown> | null;
	stale: string | null;
}

export interface ProposalDetail {
	proposal: Proposal;
	venture: { id: string; slug: string; name: string; lastSeq: number };
	thread: { id: string; title: string; ventureSlug: string | null };
	changes: ProposalChangeDetail[];
	bets: Pick<Bet, "id" | "hypothesis" | "status">[];
}
