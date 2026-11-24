import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { diffWords } from "diff";
import { PageError } from "./holding.tsx";
import { queries } from "./live.ts";
import { ago, formatDateTime } from "./time.ts";

const fields = [
	{ key: "why", label: "Why" },
	{ key: "what", label: "What" },
	{ key: "diagnosis", label: "Diagnosis" },
	{ key: "guidingPolicy", label: "Guiding policy" },
] as const;

export function HistoryPage() {
	const { slug } = useParams({ from: "/v/$slug/history" });
	const search = useSearch({ from: "/v/$slug/history" });
	const navigate = useNavigate({ from: "/v/$slug/history" });
	const versions = useQuery(queries.versions(slug));
	const cockpit = useQuery(queries.cockpit(slug));

	const header = (
		<header className="topbar">
			<Link to="/v/$slug" params={{ slug }} className="crumb">
				{cockpit.data?.venture.name ?? slug}
			</Link>
			<span className="muted" aria-hidden>
				/
			</span>
			<h1>Strategy history</h1>
		</header>
	);

	if (versions.isPending) {
		return (
			<>
				{header}
				<div className="page skeleton-stack" aria-busy="true">
					<span className="skeleton" style={{ width: "40%" }} />
					<span className="skeleton" style={{ width: "70%" }} />
				</div>
			</>
		);
	}

	if (versions.isError) return <PageError error={versions.error} retry={() => void versions.refetch()} />;

	const list = versions.data.versions;
	const latest = list[0]?.version ?? 1;
	const selectedNumber = search.v ?? latest;
	const selected = list.find((version) => version.version === selectedNumber) ?? list[0];

	if (selected === undefined) return header;

	const baseNumber = search.from ?? selected.version - 1;
	const base = list.find((version) => version.version === baseNumber && version.version < selected.version) ?? null;

	const pick = (v: number) => void navigate({ search: { v } });

	return (
		<>
			{header}
			<div className="history">
				<ol className="versions" aria-label="Versions">
					{list.map((version) => (
						<li key={version.id}>
							<button
								type="button"
								className={version.status === "active" ? "version is-active" : "version"}
								aria-current={version.version === selected.version}
								onClick={() => pick(version.version)}
							>
								<span className="version-top">
									<span className="pixel" aria-hidden />
									<span className="data">v{version.version}</span>
									{version.status === "active" ? <span className="tag">active</span> : null}
									<span className="muted" style={{ marginLeft: "auto" }}>
										{ago(version.activatedAt ?? version.createdAt, Date.now())}
									</span>
								</span>
								<span className="version-reason">
									{version.reason ?? (version.version === 1 ? "First version" : "No reason recorded")}
								</span>
							</button>
						</li>
					))}
				</ol>

				<div className="diff-page">
					<div className="compare">
						<span className="muted">Compare</span>
						<select
							className="select data"
							aria-label="Compare from version"
							value={base?.version ?? ""}
							disabled={selected.version === 1}
							onChange={(event) =>
								void navigate({ search: { v: selected.version, from: Number(event.target.value) } })
							}
						>
							{selected.version === 1 ? <option value="">nothing</option> : null}
							{list
								.filter((version) => version.version < selected.version)
								.map((version) => (
									<option key={version.id} value={version.version}>
										v{version.version}
									</option>
								))}
						</select>
						<span className="muted">to</span>
						<span className="data">v{selected.version}</span>
						<span className="muted" style={{ marginLeft: "auto" }}>
							{selected.createdBy} · {formatDateTime(selected.activatedAt ?? selected.createdAt)}
						</span>
					</div>

					{selected.reason === null ? null : (
						<div className="reason-card">
							<p className="field-label">Reason for v{selected.version}</p>
							<p>{selected.reason}</p>
						</div>
					)}

					<dl>
						{fields.map(({ key, label }) => (
							<DiffField key={key} label={label} before={base?.[key] ?? null} after={selected[key]} />
						))}
					</dl>
				</div>
			</div>
		</>
	);
}

function diffParts(before: string, after: string) {
	let offset = 0;

	return diffWords(before, after).map((part) => {
		const kind = part.added ? "added" : part.removed ? "removed" : "same";
		const key = `${kind}:${offset}`;

		offset += part.value.length;

		return { kind, key, value: part.value };
	});
}

export function DiffField({ label, before, after }: { label: string; before: string | null; after: string }) {
	const same = before !== null && before === after;

	return (
		<div className={same ? "diff-field is-same" : "diff-field"}>
			<dt>
				{label}
				{same ? <span className="visually-hidden"> (unchanged)</span> : null}
			</dt>
			<dd>
				{before === null || same ? (
					after === "" ? (
						<span className="muted">Empty</span>
					) : (
						after
					)
				) : (
					diffParts(before, after).map((part) =>
						part.kind === "added" ? (
							<ins key={part.key} className="diff-add">
								{part.value}
							</ins>
						) : part.kind === "removed" ? (
							<del key={part.key} className="diff-remove">
								{part.value}
							</del>
						) : (
							<span key={part.key}>{part.value}</span>
						),
					)
				)}
			</dd>
		</div>
	);
}
