import type { Cockpit } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { keys, queries, rememberVenture } from "./live.ts";
import { accent } from "./marks.tsx";
import { Hero, Sec, Skeleton } from "./parts.tsx";
import { GitHubPanel, Repos } from "./repos.tsx";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";

function ArchiveVenture({ cockpit }: { cockpit: Cockpit }) {
	const [confirming, setConfirming] = useState(false);
	const navigate = useNavigate();
	const client = useQueryClient();
	const { venture } = cockpit;

	const archive = useCommand("venture.archive", () => {
		void client.invalidateQueries({ queryKey: keys.ventures });

		toast(
			<>
				Archived <b>{venture.name}</b>
			</>,
		);

		void navigate({ to: "/" });
	});

	return (
		<section aria-labelledby="archive-heading">
			<Sec title="Archive venture" id="archive-heading" />
			<div className="danger-zone">
				<p>
					Archiving takes {venture.name} out of the Holding and stops all changes to it. Its strategy, history and
					threads stay readable; its repos on GitHub are untouched.
				</p>
				{confirming ? (
					<div className="danger-acts">
						<button
							type="button"
							className="btn danger sm"
							disabled={archive.isPending}
							onClick={() => archive.mutate({ payload: { ventureId: venture.id } })}
						>
							Archive {venture.name}
						</button>
						<button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
							Keep it
						</button>
					</div>
				) : (
					<button type="button" className="btn sm" onClick={() => setConfirming(true)}>
						Archive…
					</button>
				)}
				{archive.isError ? <p className="err">{describeError(archive.error)}</p> : null}
			</div>
		</section>
	);
}

export function SettingsPage() {
	const { slug } = useParams({ from: "/v/$slug/settings" });
	const cockpit = useQuery(queries.cockpit(slug));

	if (cockpit.isPending) {
		return (
			<div className="page narrow">
				<Skeleton label="Loading settings…" widths={[50, 80, 70]} />
			</div>
		);
	}

	if (cockpit.isError) return <PageError error={cockpit.error} retry={() => void cockpit.refetch()} />;

	rememberVenture(cockpit.data.venture.id, slug, cockpit.data.venture.lastSeq);

	return (
		<div className="page narrow settings" style={accent(slug)}>
			<Hero cap={cockpit.data.venture.name} title="Settings" />
			<GitHubPanel slug={slug} />
			<Repos slug={slug} ventureId={cockpit.data.venture.id} />
			<ArchiveVenture cockpit={cockpit.data} />
		</div>
	);
}
