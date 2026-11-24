import type { betStatuses, ventureKinds, workFunctions, workPriorities, workStatuses } from "./commands.ts";

export type VentureKind = (typeof ventureKinds)[number];

export type BetStatus = (typeof betStatuses)[number];

export type WorkStatus = (typeof workStatuses)[number];

export type WorkFunction = (typeof workFunctions)[number];

export type WorkPriority = (typeof workPriorities)[number];

export type StrategyStatus = "draft" | "active" | "superseded";

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
