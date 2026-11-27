import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { z } from "zod";
import { HoldingActivityPage, VentureActivityPage } from "./activity.tsx";
import { AgentsPage } from "./agents.tsx";
import { CockpitPage, StrategyPage } from "./cockpit.tsx";
import { CreateVenture } from "./create-venture.tsx";
import { HistoryPage } from "./history.tsx";
import { HoldingPage, PageError } from "./holding.tsx";
import { InboxPage } from "./inbox.tsx";
import { SettingsPage } from "./settings.tsx";
import { Shell } from "./shell.tsx";
import { HoldingThreadsPage, VentureThreadsPage } from "./threads.tsx";
import { HoldingWorkPage, VentureWorkPage } from "./work.tsx";

const rootRoute = createRootRoute({ component: Shell });

const holdingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HoldingPage });

const newVentureRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new",
	component: () => <CreateVenture />,
});

const holdingActivityRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/activity",
	component: HoldingActivityPage,
});

const workSearch = z.object({ item: z.string().optional() });

const holdingWorkRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/work",
	validateSearch: workSearch,
	component: HoldingWorkPage,
});

const threadsSearch = z.object({
	thread: z.string().optional(),
	space: z.string().optional(),
	new: z.enum(["thread", "space"]).optional(),
	in: z.string().optional(),
	link: z.string().optional(),
	label: z.string().optional(),
});

const holdingThreadsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/threads",
	validateSearch: threadsSearch,
	component: HoldingThreadsPage,
});

const inboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/inbox",
	validateSearch: z.object({
		proposal: z.string().optional(),
		access: z.string().optional(),
		question: z.string().optional(),
		draft: z.string().optional(),
	}),
	component: InboxPage,
});

const agentsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents",
	component: AgentsPage,
});

const ventureRoute = createRoute({ getParentRoute: () => rootRoute, path: "/v/$slug" });

const cockpitRoute = createRoute({ getParentRoute: () => ventureRoute, path: "/", component: CockpitPage });

const historySearch = z.object({
	v: z.coerce.number().int().positive().optional(),
	from: z.coerce.number().int().positive().optional(),
});

const historyRoute = createRoute({
	getParentRoute: () => ventureRoute,
	path: "/history",
	validateSearch: historySearch,
	component: HistoryPage,
});

const strategyRoute = createRoute({ getParentRoute: () => ventureRoute, path: "/strategy", component: StrategyPage });

const settingsRoute = createRoute({
	getParentRoute: () => ventureRoute,
	path: "/settings",
	component: SettingsPage,
});

const ventureActivityRoute = createRoute({
	getParentRoute: () => ventureRoute,
	path: "/activity",
	component: VentureActivityPage,
});

const ventureWorkRoute = createRoute({
	getParentRoute: () => ventureRoute,
	path: "/work",
	validateSearch: workSearch,
	component: VentureWorkPage,
});

const ventureThreadsRoute = createRoute({
	getParentRoute: () => ventureRoute,
	path: "/threads",
	validateSearch: threadsSearch,
	component: VentureThreadsPage,
});

const routeTree = rootRoute.addChildren([
	holdingRoute,
	newVentureRoute,
	holdingActivityRoute,
	holdingWorkRoute,
	holdingThreadsRoute,
	inboxRoute,
	agentsRoute,
	ventureRoute.addChildren([
		cockpitRoute,
		strategyRoute,
		settingsRoute,
		historyRoute,
		ventureWorkRoute,
		ventureThreadsRoute,
		ventureActivityRoute,
	]),
]);

export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	defaultErrorComponent: ({ error, reset }) => <PageError error={error} retry={reset} />,
	defaultNotFoundComponent: () => (
		<div className="page-error" role="alert">
			<p>There's nothing at this address.</p>
		</div>
	),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
