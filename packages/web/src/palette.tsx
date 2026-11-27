import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { queries } from "./live.ts";
import { Crest, Drone, hueOf, Icon, isSquare } from "./marks.tsx";
import { useAgentLookup } from "./working.tsx";

interface PaletteItem {
	key: string;
	label: string;
	sub: string;
	glyph: ReactNode;
	accent?: string;
	go: () => void;
}

/** The command menu: jump to a venture, a view or a thread. */
export function Palette({ scope, close }: { scope: string | null; close: () => void }) {
	const navigate = useNavigate();
	const ventures = useQuery(queries.ventures()).data?.ventures ?? [];
	const threads = useQuery(queries.threads({})).data?.threads ?? [];
	const waiting = useQuery(queries.inbox()).data?.pending.length ?? 0;
	const agentOf = useAgentLookup();
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const list = useRef<HTMLDivElement>(null);
	const cursor = useRef<HTMLElement>(null);
	const prefix = scope === null ? "" : `/v/${scope}`;
	const scopeName = scope === null ? "Holding" : (ventures.find((venture) => venture.slug === scope)?.name ?? scope);

	const items: PaletteItem[] = [
		...ventures.map((venture) => ({
			key: `venture:${venture.id}`,
			label: venture.name,
			sub: "Venture",
			glyph: <Crest seed={venture.slug} size={14} />,
			accent: hueOf(venture.slug),
			go: () => void navigate({ to: "/v/$slug", params: { slug: venture.slug } }),
		})),
		{
			key: "holding",
			label: "Holding",
			sub: "All ventures",
			glyph: <Icon name="holding" />,
			go: () => void navigate({ to: "/" }),
		},
		{
			key: "inbox",
			label: "Inbox",
			sub: waiting === 0 ? "Nothing waiting" : `${waiting} waiting`,
			glyph: <Icon name="inbox" />,
			go: () => void navigate({ to: "/inbox" }),
		},
		{
			key: "agents",
			label: "Agents",
			sub: "What each agent may change",
			glyph: <Icon name="agents" />,
			go: () => void navigate({ to: "/agents" }),
		},
		...(scope === null
			? (["work", "threads", "activity"] as const)
			: (["strategy", "work", "threads", "activity", "settings"] as const)
		).map((view) => ({
			key: view,
			label: view.charAt(0).toUpperCase() + view.slice(1),
			sub: scopeName,
			glyph: <Icon name={view} />,
			go: () => void navigate({ to: `${prefix}/${view}` }),
		})),
		{
			key: "new",
			label: "New venture",
			sub: "Create",
			glyph: <Icon name="plus" />,
			go: () => void navigate({ to: "/new" }),
		},
		...threads.map((thread) => {
			const venture = ventures.find((candidate) => candidate.id === thread.ventureId);

			return {
				key: `thread:${thread.id}`,
				label: thread.title,
				sub: venture === undefined ? "Thread" : `Thread · ${venture.name}`,
				glyph: <Drone size={14} square={isSquare(agentOf(thread.agentProfileId))} />,
				accent: venture === undefined ? undefined : hueOf(venture.slug),
				go: () =>
					void (venture === undefined
						? navigate({ to: "/threads", search: { thread: thread.id } })
						: navigate({
								to: "/v/$slug/threads",
								params: { slug: venture.slug },
								search: { thread: thread.id },
							})),
			};
		}),
	];

	const needle = query.trim().toLowerCase();
	const shown = items.filter((item) => `${item.label} ${item.sub}`.toLowerCase().includes(needle));
	const active = Math.min(index, Math.max(0, shown.length - 1));

	useEffect(() => {
		const before = document.activeElement;

		return () => {
			if (before instanceof HTMLElement) before.focus();
		};
	}, []);

	useLayoutEffect(() => {
		const option = list.current?.querySelectorAll<HTMLElement>(".opt")[active];
		const mark = cursor.current;

		if (mark === null) return;

		mark.style.display = option === undefined ? "none" : "";

		if (option === undefined) return;

		mark.style.translate = `0 ${option.offsetTop}px`;

		mark.style.height = `${option.offsetHeight}px`;

		option.scrollIntoView({ block: "nearest" });
	});

	const go = (item: PaletteItem | undefined) => {
		if (item === undefined) return;

		close();

		item.go();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();

			if (shown.length > 0) setIndex((active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
		} else if (event.key === "Enter") {
			event.preventDefault();

			go(shown[active]);
		} else if (event.key === "Escape") {
			event.preventDefault();

			close();
		} else if (event.key === "Tab") {
			event.preventDefault();
		}
	};

	return (
		<div className="veil">
			<button type="button" className="veil-x" aria-label="Close" tabIndex={-1} onClick={close} />
			<div className="pal" role="dialog" aria-modal="true" aria-label="Jump to anything">
				<input
					ref={(element) => element?.focus()}
					role="combobox"
					aria-expanded
					aria-controls="palette-list"
					aria-activedescendant={shown.length === 0 ? undefined : `palette-${active}`}
					aria-label="Jump to a venture, view or thread"
					placeholder="Jump to a venture, view or thread"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);

						setIndex(0);
					}}
					onKeyDown={onKeyDown}
				/>
				<div className="pal-l" id="palette-list" role="listbox" aria-label="Destinations" ref={list}>
					<i className="cur" ref={cursor} />
					{shown.length === 0 ? <p className="pal-none">Nothing matches.</p> : null}
					{shown.map((item, at) => (
						<div
							key={item.key}
							id={`palette-${at}`}
							role="option"
							tabIndex={-1}
							aria-selected={at === active}
							className={at === active ? "opt on" : "opt"}
							style={item.accent === undefined ? undefined : ({ "--acc": item.accent } as CSSProperties)}
							onMouseEnter={() => setIndex(at)}
							onMouseDown={(event) => {
								event.preventDefault();

								go(item);
							}}
						>
							{item.glyph}
							<span>{item.label}</span>
							<span className="sub">{item.sub}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
