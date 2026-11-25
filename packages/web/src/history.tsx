import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { diffWords } from "diff";
import { PageError } from "./holding.tsx";
import { queries } from "./live.ts";
import { accent, Icon } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Hero, Skeleton } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
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
	const list = versions.data?.versions ?? [];

	const hero = (
		<Hero
			cap={
				<>
					<Link to="/v/$slug" params={{ slug }}>
						<Icon name="right" className="back" />
						{cockpit.data?.venture.name ?? slug}
					</Link>
					{versions.isSuccess ? ` · ${list.length === 1 ? "1 version" : `${list.length} versions`}` : null}
				</>
			}
			title="Strategy history"
		/>
	);

	if (versions.isPending) {
		return (
			<div className="page" style={accent(slug)}>
				{hero}
				<Skeleton label="Loading versions…" widths={[40, 70]} />
			</div>
		);
	}

	if (versions.isError) return <PageError error={versions.error} retry={() => void versions.refetch()} />;

	const latest = list[0]?.version ?? 1;
	const selectedNumber = search.v ?? latest;
	const selected = list.find((version) => version.version === selectedNumber) ?? list[0];

	if (selected === undefined) return <div className="page">{hero}</div>;

	const baseNumber = search.from ?? selected.version - 1;
	const base = list.find((version) => version.version === baseNumber && version.version < selected.version) ?? null;
	const changed = base === null ? 0 : fields.filter(({ key }) => base[key] !== selected[key]).length;
	const now = Date.now();

	return (
		<div className="page" style={accent(slug)}>
			{hero}
			<div className="hist">
				<ol aria-label="Versions">
					{list.map((version) => (
						<li key={version.id}>
							<button
								type="button"
								className="ver"
								aria-current={version.version === selected.version ? "true" : undefined}
								onClick={() => void navigate({ search: { v: version.version } })}
							>
								<b>v{version.version}</b>
								<span>
									{version.reason ?? (version.version === 1 ? "First version" : "No reason recorded")}
								</span>
								<time className="mono" dateTime={version.activatedAt ?? version.createdAt}>
									{ago(version.activatedAt ?? version.createdAt, now)}
									{version.status === "active" ? <span className="tag acc">Active</span> : null}
								</time>
							</button>
						</li>
					))}
				</ol>

				<div>
					<div className="hist-bar">
						<b>v{selected.version}</b>
						<span className="cap">compared with</span>
						{base === null ? (
							<span className="tag">Nothing</span>
						) : (
							<Select
								title="Compare from"
								value={String(base.version)}
								options={list
									.filter((version) => version.version < selected.version)
									.map((version) => ({
										value: String(version.version),
										label: `v${version.version}`,
										sub: version.reason ?? (version.version === 1 ? "First version" : undefined),
									}))}
								onChange={(from) => void navigate({ search: { v: selected.version, from: Number(from) } })}
							/>
						)}
						<i className="dots" />
						<span className="cap">
							{base === null ? null : `${changed === 1 ? "1 field" : `${changed} fields`} changed · `}
							{actorName(selected.createdBy)} · {formatDateTime(selected.activatedAt ?? selected.createdAt)}
						</span>
					</div>

					{selected.reason === null ? null : <p className="rev-why hist-why">{selected.reason}</p>}

					<dl className="strat">
						{fields.map(({ key, label }) => (
							<DiffField key={key} label={label} before={base?.[key] ?? null} after={selected[key]} />
						))}
					</dl>
				</div>
			</div>
		</div>
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

export function DiffField({
	label,
	before,
	after,
	className = "strat-row",
}: {
	label: string;
	before: string | null;
	after: string;
	className?: string;
}) {
	const same = before !== null && before === after;
	const changed = before !== null && !same;

	return (
		<div className={same ? `${className} same` : className}>
			<dt className={className === "strat-row" ? undefined : "cap"}>
				{label}
				{same ? <span className="vh"> (unchanged)</span> : null}
				{changed && className === "strat-row" ? <span className="cap dim">Changed</span> : null}
			</dt>
			<dd>
				{before === null || same ? (
					after === "" ? (
						<span className="mute">Empty</span>
					) : (
						after
					)
				) : (
					diffParts(before, after).map((part) =>
						part.kind === "added" ? (
							<ins key={part.key} className="ins">
								{part.value}
							</ins>
						) : part.kind === "removed" ? (
							<del key={part.key} className="del">
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
