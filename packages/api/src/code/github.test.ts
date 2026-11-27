import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readCodeConfig } from "./config.ts";
import { appJwt, appManifest, appPermissions, manifestPage } from "./github.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const config = readCodeConfig({ BRAISE_HOME: "/tmp/braise-test-home", PORT: "4400" });

describe("appJwt", () => {
	it("signs a short-lived RS256 token that the App's public key verifies", () => {
		const token = appJwt(1234, privateKey.export({ type: "pkcs1", format: "pem" }).toString(), 1_800_000_000);
		const [header = "", payload = "", signature = ""] = token.split(".");

		const verified = createVerify("RSA-SHA256")
			.update(`${header}.${payload}`)
			.verify(publicKey, signature, "base64url");

		expect(verified).toBe(true);

		expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
			iat: 1_799_999_940,
			exp: 1_800_000_540,
			iss: "1234",
		});
	});
});

describe("appManifest", () => {
	it("asks for the slice's permissions, no webhooks and a redirect to the local API", () => {
		expect(appManifest(config, "braise-abc123")).toMatchObject({
			name: "braise-abc123",
			public: false,
			hook_attributes: { active: false },
			redirect_url: "http://localhost:4400/api/github/callback",
			setup_url: "http://localhost:4400/api/github/installed",
			default_events: [],
			default_permissions: appPermissions,
		});

		expect(appPermissions).toEqual({
			contents: "write",
			pull_requests: "write",
			checks: "read",
			statuses: "read",
			metadata: "read",
		});
	});

	it("posts the manifest to the user's or an organisation's new App page", () => {
		expect(manifestPage(config, { state: "s1", org: null })).toContain(
			'action="https://github.com/settings/apps/new?state=s1"',
		);

		expect(manifestPage(config, { state: "s1", org: "acme" })).toContain(
			'action="https://github.com/organizations/acme/settings/apps/new?state=s1"',
		);
	});
});
