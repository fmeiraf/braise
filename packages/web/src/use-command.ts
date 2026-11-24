import type { CommandInput, CommandName, CommandResponse } from "@braise/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api.ts";

function newKey() {
	return crypto.randomUUID();
}

export function useCommand<Name extends CommandName, Result>(
	name: Name,
	onSuccess: (response: CommandResponse<Result>) => void,
) {
	const [idempotencyKey, setIdempotencyKey] = useState(newKey);

	const mutation = useMutation({
		mutationFn: (input: { payload: CommandInput<Name>; reason?: string }) =>
			api.command<Name, Result>(name, { ...input, idempotencyKey }),
		onSuccess: (response) => {
			setIdempotencyKey(newKey());

			onSuccess(response);
		},
	});

	return mutation;
}
