import { slugify, type VentureKind } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import type { CreatedVenture } from "./api.ts";
import { describeError, errorField } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { kindLabel } from "./labels.ts";
import { keys, queries, rememberVenture } from "./live.ts";
import { accent, Crest } from "./marks.tsx";
import { Hero } from "./parts.tsx";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";

const kernelFields = [
	{ key: "why", label: "Why", hint: "Why this venture should exist.", required: true },
	{ key: "what", label: "What", hint: "What it is, in a sentence or two.", required: true },
	{ key: "diagnosis", label: "Diagnosis", hint: "The crux of the challenge.", required: false },
	{ key: "guidingPolicy", label: "Guiding policy", hint: "The approach that answers the diagnosis.", required: false },
] as const;

export function CreateVenture({ firstRun = false }: { firstRun?: boolean }) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const ventures = useQuery(queries.ventures());
	const [name, setName] = useState("");
	const [slug, setSlug] = useState<string | null>(null);
	const [kind, setKind] = useState<VentureKind>("for_profit");
	const [kernel, setKernel] = useState({ why: "", what: "", diagnosis: "", guidingPolicy: "" });

	const create = useCommand<"venture.create", CreatedVenture>("venture.create", (response) => {
		const { venture } = response.result;

		rememberVenture(venture.id, venture.slug, response.seq);

		void client.invalidateQueries({ queryKey: keys.ventures });

		toast(
			<>
				<b>{venture.name}</b> joined the holding
			</>,
		);

		void navigate({ to: "/v/$slug", params: { slug: venture.slug } });
	});

	const effectiveSlug = slug ?? slugify(name);
	const failedField = create.isError ? errorField(create.error) : null;
	const previewSlug = effectiveSlug === "" ? "unnamed" : effectiveSlug;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		create.mutate({
			payload: { name: name.trim(), slug: effectiveSlug === "" ? undefined : effectiveSlug, kind, ...kernel },
		});
	};

	return (
		<div className="page">
			<Hero
				cap={firstRun ? "Your first venture" : `Venture ${(ventures.data?.ventures.length ?? 0) + 1}`}
				title={firstRun ? "Start your holding" : "New venture"}
			/>
			<p className="lede create-lede">
				{firstRun
					? "Add your first venture. Its strategy starts at v1 and every revision keeps the reason it changed."
					: "Name it and write down why it exists. Diagnosis and guiding policy can wait."}
			</p>

			<div className="create" style={accent(previewSlug)}>
				<form className="form" onSubmit={submit}>
					<div className="form-2">
						<label className="field">
							<span className="cap">Name</span>
							<input
								className="inp"
								value={name}
								required
								maxLength={120}
								autoComplete="off"
								ref={focusOnMount}
								aria-invalid={failedField === "name"}
								onChange={(event) => setName(event.target.value)}
							/>
						</label>
						<label className="field">
							<span className="cap">Slug</span>
							<span className="sluginp">
								<span className="mono mute">/v/</span>
								<input
									className="inp"
									value={effectiveSlug}
									pattern="[a-z0-9]+(-[a-z0-9]+)*"
									maxLength={64}
									aria-invalid={failedField === "slug"}
									onChange={(event) => setSlug(event.target.value)}
								/>
							</span>
						</label>
					</div>

					<fieldset className="field">
						<legend className="cap">Kind</legend>
						<span className="seg">
							{(["for_profit", "non_profit"] as const).map((option) => (
								<button
									key={option}
									type="button"
									aria-pressed={kind === option}
									onClick={() => setKind(option)}
								>
									{kindLabel[option]}
								</button>
							))}
						</span>
					</fieldset>

					{kernelFields.map((field) => (
						<label key={field.key} className="field">
							<span className="cap">
								{field.label}
								<span>{field.required ? "Required" : "Optional"}</span>
							</span>
							<textarea
								className="ta"
								rows={2}
								value={kernel[field.key]}
								required={field.required}
								placeholder={field.hint}
								onChange={(event) => setKernel((current) => ({ ...current, [field.key]: event.target.value }))}
							/>
						</label>
					))}

					{create.isError ? (
						<p className="err" role="alert">
							{describeError(create.error)}
						</p>
					) : null}

					<div className="form-acts">
						<button type="submit" className="btn pri" disabled={create.isPending}>
							{create.isPending ? "Creating…" : "Create venture"}
						</button>
						{firstRun ? null : (
							<Link to="/" className="btn ghost">
								Cancel
							</Link>
						)}
					</div>
				</form>

				<div className="preview">
					<span className="cap">Its crest and colour are drawn from the slug</span>
					<div className="vc">
						<div className="vc-top">
							<Crest seed={previewSlug} size={44} />
							<span className="cap">{kindLabel[kind]}</span>
						</div>
						<h3>{name.trim() === "" ? "Unnamed" : name}</h3>
						<p>{kernel.what.trim() === "" ? "What it is, in a sentence or two." : kernel.what}</p>
						<div className="vc-foot">
							<span className="cap mono">/v/{previewSlug}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
