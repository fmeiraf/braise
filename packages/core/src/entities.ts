import type {
	accessRequestStatuses,
	assumptionStatuses,
	betStatuses,
	inputRequestStatuses,
	LegacyProposableCommand,
	limitStatuses,
	objectiveKinds,
	objectiveStatuses,
	ProposableCommand,
	pauseReasons,
	proposalStatuses,
	readingSubjects,
	reportOutcomes,
	runStatuses,
	runtimeNames,
	threadLinkTypes,
	ventureKinds,
	workFunctions,
	workPriorities,
	workStatuses,
} from "./commands.ts";
import type { Capability } from "./grants.ts";
import type { BetMethod, BetResult, FailCause, Impact } from "./loop.ts";

export type VentureKind = (typeof ventureKinds)[number];

export type ObjectiveKind = (typeof objectiveKinds)[number];

export type ObjectiveStatus = (typeof objectiveStatuses)[number];

export type AssumptionStatus = (typeof assumptionStatuses)[number];

export type BetStatus = (typeof betStatuses)[number];

export type ReadingSubject = (typeof readingSubjects)[number];

export type WorkStatus = (typeof workStatuses)[number];

export type WorkFunction = (typeof workFunctions)[number];

export type WorkPriority = (typeof workPriorities)[number];

export type StrategyStatus = "draft" | "active" | "superseded";

export type ThreadLinkType = (typeof threadLinkTypes)[number];

export type RunStatus = (typeof runStatuses)[number];

export type ProposalStatus = (typeof proposalStatuses)[number];

export type AccessRequestStatus = (typeof accessRequestStatuses)[number];

export type ReportOutcome = (typeof reportOutcomes)[number];

export type InputRequestStatus = (typeof inputRequestStatuses)[number];

export type RuntimeName = (typeof runtimeNames)[number];

export type LimitStatus = (typeof limitStatuses)[number];

export type PauseReason = (typeof pauseReasons)[number];

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

export interface DoneItem {
	id: string;
	text: string;
	done: boolean;
}

export interface Objective {
	id: string;
	ventureId: string;
	kind: ObjectiveKind;
	statement: string;
	measure: string | null;
	unit: string;
	baseline: number | null;
	target: number | null;
	decision: string | null;
	doneRule: string | null;
	doneList: DoneItem[];
	byDate: string | null;
	guardrails: string;
	budget: string;
	status: ObjectiveStatus;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	archivedAt: string | null;
}

export interface Assumption {
	id: string;
	ventureId: string;
	objectiveId: string | null;
	statement: string;
	impact: Impact;
	confidence: number;
	function: WorkFunction;
	status: AssumptionStatus;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export interface Bet {
	id: string;
	ventureId: string;
	assumptionId: string;
	function: WorkFunction;
	action: string;
	signal: string;
	unit: string;
	baseline: number | null;
	passAt: number;
	failAt: number;
	method: BetMethod;
	budget: string;
	deadline: string;
	status: BetStatus;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	archivedAt: string | null;
}

export interface Learning {
	id: string;
	ventureId: string;
	betId: string;
	assumptionId: string;
	result: BetResult;
	cause: FailCause | null;
	statement: string;
	value: number | null;
	confidenceFrom: number;
	confidenceTo: number;
	function: WorkFunction;
	createdBy: string;
	createdAt: string;
}

export interface Reading {
	id: string;
	ventureId: string;
	subjectType: ReadingSubject;
	subjectId: string;
	value: number;
	takenOn: string;
	source: string;
	enteredBy: string;
	createdAt: string;
}

/** A bet an agent proposed that waits in the inbox. */
export interface ProposedBet {
	proposalId: string;
	assumptionId: string;
	action: string;
	createdBy: string;
}

export interface WorkItem {
	id: string;
	ventureId: string;
	betId: string | null;
	objectiveId: string | null;
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
	objectives: Objective[];
	bets: Bet[];
	workItems: WorkItem[];
}

export interface HoldingWork {
	ventures: { id: string; slug: string; name: string; lastSeq: number }[];
	objectives: Objective[];
	bets: Bet[];
	workItems: WorkItem[];
}

export interface HoldingRow {
	id: string;
	slug: string;
	name: string;
	kind: VentureKind;
	objective: string | null;
	openBets: number;
	openAssumptions: number;
	strategyVersion: number;
	lastSeq: number;
	lastActivityAt: string;
}

export interface Cockpit {
	venture: Venture;
	strategy: StrategyVersion;
	objectives: Objective[];
	assumptions: Assumption[];
	bets: Bet[];
	learnings: Learning[];
	readings: Reading[];
	proposedBets: ProposedBet[];
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
	"not_in_space_chat",
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
	spaceId: string | null;
	startedByRunId: string | null;
	agentProfileId: string;
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
	meta: MessageMeta | null;
	createdAt: string;
}

export type MessageMeta =
	| { kind: "report"; threadId: string; runId: string; outcome: ReportOutcome }
	| { kind: "question"; inputRequestId: string };

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
	error: RunError | null;
	usage: RunUsage | null;
	createdAt: string;
	startedAt: string | null;
	firstTokenAt: string | null;
	finishedAt: string | null;
	cancelRequestedAt: string | null;
}

export interface RunError {
	message: string;
	code?: "limit";
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
	needsInput: boolean;
}

export interface InputRequest {
	id: string;
	threadId: string;
	runId: string;
	question: string;
	status: InputRequestStatus;
	createdAt: string;
	answeredAt: string | null;
}

export interface ThreadDetail {
	thread: Thread;
	agent: { id: string; name: string };
	venture: { id: string; slug: string; name: string } | null;
	space: { id: string; title: string; isChat: boolean } | null;
	inputRequest: InputRequest | null;
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
	runtime: string;
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
	command: ProposableCommand | LegacyProposableCommand;
	payload: Record<string, unknown>;
	base: ChangeBase;
}

export interface AppliedChange {
	command: ProposableCommand | LegacyProposableCommand;
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
	kind: "proposal";
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

export interface InboxAccessRequest {
	kind: "access_request";
	id: string;
	agent: { id: string; name: string };
	capability: Capability;
	command: string;
	payload: Record<string, unknown>;
	references: Record<string, string>;
	summary: string;
	attempts: number;
	venture: { id: string; slug: string; name: string } | null;
	thread: { id: string; title: string; ventureSlug: string | null };
	runId: string;
	status: AccessRequestStatus;
	note: string | null;
	createdAt: string;
	decidedAt: string | null;
}

export interface InboxNeedsInput {
	kind: "needs_input";
	id: string;
	agent: { id: string; name: string };
	question: string;
	venture: { id: string; slug: string; name: string } | null;
	thread: { id: string; title: string; ventureSlug: string | null };
	space: { id: string; title: string } | null;
	runId: string;
	status: InputRequestStatus;
	createdAt: string;
	decidedAt: string | null;
}

export type InboxItem = InboxProposal | InboxAccessRequest | InboxNeedsInput;

export interface Inbox {
	pending: InboxItem[];
	decided: InboxItem[];
}

export interface AgentCapability {
	capability: Capability;
	granted: boolean;
	changedAt: string | null;
	changedBy: string | null;
	viaRequest: boolean;
	pendingRequestId: string | null;
}

export interface AgentOverview {
	id: string;
	actor: string;
	name: string;
	runtime: string;
	model: string;
	capabilities: AgentCapability[];
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
	objectives: Pick<Objective, "id" | "statement" | "kind" | "status">[];
	assumptions: Pick<Assumption, "id" | "statement" | "confidence" | "objectiveId">[];
	bets: Pick<Bet, "id" | "action" | "status" | "assumptionId" | "method">[];
}

export interface Space {
	id: string;
	ventureId: string | null;
	title: string;
	goal: string | null;
	agentProfileId: string;
	chatThreadId: string;
	wakesSinceOwner: number;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
}

export type MemberState = "needs_you" | "running" | "queued" | "done";

export interface SpaceSummary extends Space {
	venture: { id: string; slug: string; name: string } | null;
	agent: { id: string; name: string };
	counts: Record<MemberState, number>;
	chatActive: boolean;
	pausedForOwner: boolean;
}

export interface SpaceMember {
	thread: Thread;
	agent: { id: string; name: string; runtime: string };
	state: MemberState;
	latestRun: Pick<Run, "id" | "status" | "createdAt" | "startedAt" | "finishedAt" | "error"> | null;
	question: string | null;
}

export interface SpaceDetail {
	space: SpaceSummary;
	members: SpaceMember[];
	stats: { runs: number; inputTokens: number; outputTokens: number; costUsd: number };
}

export interface LimitReading {
	runtime: RuntimeName;
	window: string;
	status: LimitStatus;
	utilization: number | null;
	resetsAt: string | null;
	observedAt: string;
}

export interface RuntimePause {
	id: string;
	runtime: RuntimeName;
	reason: PauseReason;
	until: string | null;
	createdAt: string;
}

export interface RuntimeDay {
	day: string;
	runs: number;
	failed: number;
	interrupted: number;
	queueWaitP50Ms: number | null;
	queueWaitP95Ms: number | null;
	firstTokenP50Ms: number | null;
	firstTokenP95Ms: number | null;
	durationP50Ms: number | null;
	durationP95Ms: number | null;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export interface RuntimeCapacity {
	runtime: RuntimeName;
	label: string;
	limit: number;
	running: number;
	queued: number;
	oldestQueuedAt: string | null;
	pause: RuntimePause | null;
	windows: LimitReading[];
	readings: LimitReading[];
	days: RuntimeDay[];
}

export interface Capacity {
	pauseAt: number;
	runtimes: RuntimeCapacity[];
}
