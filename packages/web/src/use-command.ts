import type { CommandInput, CommandName, CommandResponse } from "@braise/core";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "./api.ts";

type CommandRequest<Name extends CommandName> = { payload: CommandInput<Name>; reason?: string };

export function useCommand<Name extends CommandName, Result>(
	name: Name,
	onSuccess: (response: CommandResponse<Result>) => void,
) {
	const intent = useRef<{ key: string; body: string } | null>(null);

	const mutation = useMutation({
		mutationFn: (input: CommandRequest<Name>) => {
			const body = JSON.stringify(input);

			if (intent.current?.body !== body) intent.current = { key: crypto.randomUUID(), body };

			return api.command<Name, Result>(name, { ...input, idempotencyKey: intent.current.key });
		},
		onSuccess: (response) => {
			intent.current = null;

			onSuccess(response);
		},
	});

	return mutation;
}
