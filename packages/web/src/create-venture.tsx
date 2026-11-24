import { slugify, type VentureKind } from "@braise/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import type { CreatedVenture } from "./api.ts";
import { describeError, errorField } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { kindLabel } from "./labels.ts";
import { keys, rememberVenture } from "./live.ts";
import { useCommand } from "./use-command.ts";

export function CreateVenture({ firstRun = false }: { firstRun?: boolean }) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState<string | null>(null);
	const [kind, setKind] = useState<VentureKind>("for_profit");
	const [kernel, setKernel] = useState({ why: "", what: "", diagnosis: "", guidingPolicy: "" });

	const create = useCommand<"venture.create", CreatedVenture>("venture.create", (response) => {
		const { venture } = response.result;

		rememberVenture(venture.id, venture.slug, response.seq);

		void client.invalidateQueries({ queryKey: keys.ventures });

		void navigate({ to: "/v/$slug", params: { slug: venture.slug } });
	});

	const effectiveSlug = slug ?? slugify(name);
	const failedField = create.isError ? errorField(create.error) : null;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		create.mutate({
			payload: { name: name.trim(), slug: effectiveSlug === "" ? undefined : effectiveSlug, kind, ...kernel },
		});
	};

	const setField = (field: keyof typeof kernel) => (value: string) =>
		setKernel((current) => ({ ...current, [field]: value }));

	return (
		<>
			{firstRun ? null : (
				<header className="topbar">
					<Link to="/" className="crumb">
						Holding
					</Link>
					<span className="muted" aria-hidden>
						/
					</span>
					<h1>New venture</h1>
				</header>
			)}
			<div className="first-run">
				{firstRun ? (
					<>
						<h1>Start your holding</h1>
						<p className="lede">
							Add your first venture. Its strategy starts at v1 and every revision keeps the reason it changed.
						</p>
					</>
				) : (
					<>
						<h1>New venture</h1>
						<p className="lede">Name it and write down why it exists. Diagnosis and guiding policy can wait.</p>
					</>
				)}

				<form className="create-form" onSubmit={submit}>
					<div className="field-row">
						<label className="field">
							<span className="field-label">Name</span>
							<input
								className="input"
								value={name}
								required
								maxLength={120}
								ref={focusOnMount}
								aria-invalid={failedField === "name"}
								onChange={(event) => setName(event.target.value)}
							/>
						</label>
						<label className="field">
							<span className="field-label">Slug</span>
							<span className="slug-input">
								<span className="data">/v/</span>
								<input
									className="input data"
									value={effectiveSlug}
									pattern="[a-z0-9]+(-[a-z0-9]+)*"
									maxLength={64}
									aria-invalid={failedField === "slug"}
									onChange={(event) => setSlug(event.target.value)}
								/>
							</span>
						</label>
					</div>

					<fieldset className="field kind-field">
						<legend className="field-label">Kind</legend>
						<div className="segmented">
							{(["for_profit", "non_profit"] as const).map((option) => (
								<label key={option}>
									<input
										type="radio"
										name="kind"
										value={option}
										checked={kind === option}
										onChange={() => setKind(option)}
									/>
									{kindLabel[option]}
								</label>
							))}
						</div>
					</fieldset>

					<div className="form-divider" />

					<KernelField
						label="Why"
						hint="Why this venture should exist."
						value={kernel.why}
						onChange={setField("why")}
						required
					/>
					<KernelField
						label="What"
						hint="What it is, in a sentence or two."
						value={kernel.what}
						onChange={setField("what")}
						required
					/>
					<KernelField
						label="Diagnosis"
						hint="Optional. The crux of the challenge."
						value={kernel.diagnosis}
						onChange={setField("diagnosis")}
					/>
					<KernelField
						label="Guiding policy"
						hint="Optional. The approach that answers the diagnosis."
						value={kernel.guidingPolicy}
						onChange={setField("guidingPolicy")}
					/>

					{create.isError ? (
						<p className="error-text" role="alert">
							{describeError(create.error)}
						</p>
					) : null}

					<div className="form-actions">
						<button type="submit" className="button is-primary" disabled={create.isPending}>
							{create.isPending ? "Creating…" : "Create venture"}
						</button>
						{firstRun ? null : (
							<Link to="/" className="button is-ghost">
								Cancel
							</Link>
						)}
					</div>
				</form>
			</div>
		</>
	);
}

function KernelField(props: {
	label: string;
	hint: string;
	value: string;
	required?: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<label className="field">
			<span className="field-label">{props.label}</span>
			<textarea
				className="textarea"
				rows={2}
				value={props.value}
				required={props.required}
				placeholder={props.hint}
				onChange={(event) => props.onChange(event.target.value)}
			/>
		</label>
	);
}
