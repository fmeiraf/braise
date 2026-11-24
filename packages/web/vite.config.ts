import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, repoRoot, "");

	return {
		plugins: [react()],
		publicDir: new URL("../../assets/web", import.meta.url).pathname,
		envDir: repoRoot,
		resolve: { conditions: ["source"] },
		server: {
			port: 5400,
			strictPort: true,
			host: "127.0.0.1",
			proxy: { "/api": { target: `http://127.0.0.1:${env.PORT ?? "4400"}`, changeOrigin: false } },
		},
	};
});
