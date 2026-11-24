import { ApiRequestError } from "./api.ts";

export function describeError(error: unknown) {
	if (error instanceof ApiRequestError) {
		switch (error.code) {
			case "validation_failed": {
				const issues = error.details.issues as { path: string; message: string }[] | undefined;
				const first = issues?.[0];

				return first === undefined ? error.message : `${first.path || "Input"}: ${first.message}`;
			}
			case "idempotency_conflict":
				return "This change was already sent with different content. Send it again.";
			case "not_found":
				return "This no longer exists. It may have been archived in another tab.";
			default:
				return error.message;
		}
	}

	if (error instanceof TypeError) return "Can't reach the braise API. Is it running?";

	return "Something went wrong. Try again.";
}

export function errorField(error: unknown) {
	if (!(error instanceof ApiRequestError)) return null;

	const field = error.details.field;

	if (typeof field === "string") return field;

	const issues = error.details.issues as { path: string }[] | undefined;
	const path = issues?.[0]?.path;

	return path === undefined ? null : path.replace(/^payload\./u, "");
}
