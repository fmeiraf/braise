import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { z } from "zod";
import { HoldingActivityPage, VentureActivityPage } from "./activity.tsx";
import { CockpitPage } from "./cockpit.tsx";
import { CreateVenture } from "./create-venture.tsx";
import { HistoryPage } from "./history.tsx";
import { HoldingPage, PageError } from "./holding.tsx";
import { Shell } from "./shell.tsx";
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

const routeTree = rootRoute.addChildren([
	holdingRoute,
	newVentureRoute,
	holdingActivityRoute,
	holdingWorkRoute,
	ventureRoute.addChildren([cockpitRoute, historyRoute, ventureWorkRoute, ventureActivityRoute]),
]);

export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	defaultErrorComponent: ({ error, reset }) => <PageError error={error} retry={reset} />,
	defaultNotFoundComponent: () => (
		<div className="page-error">
			<p>There's nothing at this address.</p>
		</div>
	),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
