import { defineConfig } from "vitest/config";

const sourceConditions = {
	resolve: { conditions: ["@braise/source"] },
	ssr: { resolve: { conditions: ["@braise/source"] } },
};

export default defineConfig({
	...sourceConditions,
	test: {
		projects: [
			{
				...sourceConditions,
				test: {
					name: "unit",
					environment: "node",
					include: ["packages/*/src/**/*.test.ts"],
				},
			},
			{
				...sourceConditions,
				test: {
					name: "api",
					environment: "node",
					include: ["packages/api/test/**/*.test.ts"],
					globalSetup: ["packages/api/test/database.test-utils.ts"],
				},
			},
		],
	},
});
