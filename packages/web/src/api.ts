import type {
	ActiveRun,
	AgentOverview,
	ApiError,
	Capacity,
	Cockpit,
	CommandInput,
	CommandName,
	CommandResponse,
	DomainEvent,
	DraftSummary,
	ErrorCode,
	GitHubConnection,
	HoldingRow,
	HoldingWork,
	Inbox,
	LinkTarget,
	OperatorState,
	ProposalDetail,
	ReachableRepo,
	SpaceDetail,
	SpaceSummary,
	StrategyVersion,
	ThreadCode,
	ThreadDetail,
	ThreadSummary,
	VentureRepo,
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
	board: (slug: string) => request<Board>(`/api/ventures/${encodeURIComponent(slug)}?draft=current`),
	draft: (slug: string) => request<{ draft: DraftSummary | null }>(`/api/ventures/${encodeURIComponent(slug)}/draft`),
	operator: (slug: string) => request<OperatorState>(`/api/ventures/${encodeURIComponent(slug)}/operator`),
	versions: (slug: string) =>
		request<{ ventureId: string; lastSeq: number; versions: StrategyVersion[] }>(
			`/api/ventures/${encodeURIComponent(slug)}/strategy/versions`,
		),
	events: (slug: string, before: number | null, limit = 50) =>
		request<{ ventureId: string; lastSeq: number; events: DomainEvent[] }>(
			`/api/ventures/${encodeURIComponent(slug)}/events?limit=${limit}${before === null ? "" : `&before=${before}`}`,
		),
	work: (slug: string) => request<DraftWork>(`/api/ventures/${encodeURIComponent(slug)}/work?draft=current`),
	holdingWork: () => request<HoldingWork>("/api/work"),
	recentEvents: (limit = 100) => request<{ events: RecentEvent[] }>(`/api/events?limit=${limit}`),
	threads: (filter: { ventureId?: string; subject?: string; space?: string }) => {
		const params = new URLSearchParams();

		if (filter.ventureId !== undefined) params.set("ventureId", filter.ventureId);

		if (filter.subject !== undefined) params.set("subject", filter.subject);

		if (filter.space !== undefined) params.set("space", filter.space);

		return request<{ threads: ThreadSummary[] }>(`/api/threads?${params.toString()}`);
	},
	thread: (id: string) => request<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`),
	spaces: (ventureId: string | undefined) =>
		request<{ spaces: SpaceSummary[] }>(`/api/spaces${ventureId === undefined ? "" : `?ventureId=${ventureId}`}`),
	space: (id: string) => request<SpaceDetail>(`/api/spaces/${encodeURIComponent(id)}`),
	capacity: () => request<Capacity>("/api/capacity"),
	activeRuns: () => request<{ runs: ActiveRun[] }>("/api/runs/active"),
	inbox: () => request<Inbox>("/api/inbox"),
	agents: () => request<{ agents: AgentOverview[] }>("/api/agents"),
	proposal: (id: string) => request<ProposalDetail>(`/api/proposals/${encodeURIComponent(id)}`),
	linkTargets: (query: string, ventureId: string | null) =>
		request<{ targets: LinkTarget[] }>(
			`/api/link-targets?q=${encodeURIComponent(query)}${ventureId === null ? "" : `&ventureId=${ventureId}`}`,
		),
	github: () => request<GitHubConnection>("/api/github"),
	reachableRepos: () => request<{ repos: ReachableRepo[] }>("/api/github/repos"),
	repos: (slug: string) => request<{ repos: VentureRepo[] }>(`/api/ventures/${encodeURIComponent(slug)}/repos`),
	threadCode: (id: string) => request<ThreadCode>(`/api/threads/${encodeURIComponent(id)}/code`),
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

/** The cockpit as the venture's pages show it: with the open draft applied and marked. */
export type Board = Cockpit & { draft: DraftSummary | null };

export type DraftWork = VentureWork & { draft: DraftSummary | null };

export type CreatedVenture = Pick<Cockpit, "venture" | "strategy">;

export type ArchiveWorkResult = { workItem: WorkItem; archivedIds: string[] };
