import type { ApiError, ErrorCode } from "@braise/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const statusByCode = {
	validation_failed: 400,
	not_found: 404,
	idempotency_conflict: 409,
	rule_violated: 422,
	internal_error: 500,
} as const satisfies Record<ErrorCode, ContentfulStatusCode>;

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly details: Record<string, unknown>;

	constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
		super(message);

		this.name = "AppError";
		this.code = code;
		this.details = details;
	}

	get status() {
		return statusByCode[this.code];
	}

	toBody() {
		return { error: { code: this.code, message: this.message, details: this.details } } satisfies ApiError;
	}
}
