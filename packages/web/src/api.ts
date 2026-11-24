import type {
	ActiveRun,
	ApiError,
	Bet,
	Cockpit,
	CommandInput,
	CommandName,
	CommandResponse,
	DomainEvent,
	ErrorCode,
	Goal,
	HoldingRow,
	HoldingWork,
	LinkTarget,
	StrategyVersion,
	ThreadDetail,
	ThreadSummary,
	VentureWork,
	WorkItem,
} from "@braise/core";

export class ApiRequestError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly details: Record<string, unknown>;

	constructor(status: number, body: ApiError["error"]) {
		super(body.message);

		this.name = "ApiRequestError";
		this.code = body.code;
		this.status = status;
		this.details = body.details;
	}
}

function isApiError(body: unknown): body is ApiError {
	return typeof body === "object" && body !== null && "error" in body;
}

async function request<Body>(path: string, init?: RequestInit) {
	const response = await fetch(path, init);

	const body: unknown = await response.json().then(
		(value: unknown) => value,
		() => null,
	);

	if (!response.ok) {
		throw new ApiRequestError(
			response.status,
			isApiError(body)
				? body.error
				: { code: "internal_error", message: `The server answered ${response.status}`, details: {} },
		);
	}

	return body as Body;
}

export type RecentEvent = DomainEvent & { ventureSlug: string; ventureName: string };

export const api = {
	ventures: () => request<{ ventures: HoldingRow[] }>("/api/ventures"),
	cockpit: (slug: string) => request<Cockpit>(`/api/ventures/${encodeURIComponent(slug)}`),
	versions: (slug: string) =>
		request<{ ventureId: string; lastSeq: number; versions: StrategyVersion[] }>(
			`/api/ventures/${encodeURIComponent(slug)}/strategy/versions`,
		),
	events: (slug: string, before: number | null, limit = 50) =>
		request<{ ventureId: string; lastSeq: number; events: DomainEvent[] }>(
			`/api/ventures/${encodeURIComponent(slug)}/events?limit=${limit}${before === null ? "" : `&before=${before}`}`,
		),
	work: (slug: string) => request<VentureWork>(`/api/ventures/${encodeURIComponent(slug)}/work`),
	holdingWork: () => request<HoldingWork>("/api/work"),
	recentEvents: (limit = 100) => request<{ events: RecentEvent[] }>(`/api/events?limit=${limit}`),
	threads: (filter: { ventureId?: string; subject?: string }) => {
		const params = new URLSearchParams();

		if (filter.ventureId !== undefined) params.set("ventureId", filter.ventureId);

		if (filter.subject !== undefined) params.set("subject", filter.subject);

		return request<{ threads: ThreadSummary[] }>(`/api/threads?${params.toString()}`);
	},
	thread: (id: string) => request<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`),
	activeRuns: () => request<{ runs: ActiveRun[] }>("/api/runs/active"),
	linkTargets: (query: string, ventureId: string | null) =>
		request<{ targets: LinkTarget[] }>(
			`/api/link-targets?q=${encodeURIComponent(query)}${ventureId === null ? "" : `&ventureId=${ventureId}`}`,
		),
	command<Name extends CommandName, Result>(
		name: Name,
		input: { payload: CommandInput<Name>; idempotencyKey: string; reason?: string },
	) {
		return request<CommandResponse<Result>>(`/api/commands/${name}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
	},
};

export type CreatedVenture = Pick<Cockpit, "venture" | "strategy">;

export type ArchiveWorkResult = { workItem: WorkItem; archivedIds: string[] };

export type SetStatusResult = { bet: Bet; archivedGoals: Goal[] };
