import type { AgentOverview, WorkFunction, WorkPriority, WorkStatus } from "@braise/core";
import { type CSSProperties, useEffect, useId, useState } from "react";

const navPaths = {
	overview:
		"M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z",
	strategy: "M5.5 21V3.5 M5.5 4.5h12l-2.5 4 2.5 4h-12",
	work: "M4 4.5h16v15H4z M9.3 4.5v15 M14.7 4.5v15 M5.8 8h1.8 M11.1 8h1.8 M11.1 11h1.8 M16.4 8h1.8",
	threads: "M3.5 5h11v8H9l-3 2.8V13H3.5z M14.5 9h6v8h-2v2.8L15.5 17H11v-4",
	activity: "M3 17.5l5-5 4 3.5 8-9 M15 7h5v5",
	inbox: "M3 13.5L6 5h12l3 8.5V19H3z M3 13.5h5l1.2 2.2h5.6l1.2-2.2h5",
	agents:
		"M3.4 6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0 M15.4 6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0 M3.4 18a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0 M15.4 18a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0 M8 8l2 2 M16 8l-2 2 M8 16l2-2 M16 16l-2-2 M10 10h4v4h-4z",
	holding:
		"M3 20.5h18 M5 20.5V11l4-2v11.5 M9 20.5V4.5l6 2.5v13.5 M15 20.5v-9l4 1.5v7.5 M11.5 9.5h1 M11.5 12.5h1 M11.5 15.5h1",
} as const;

const paths = {
	plus: "M8 3v10 M3 8h10",
	x: "M4 4l8 8 M12 4l-8 8",
	check: "M3 8.5l3.5 3.5 6.5-7",
	chevr: "M6 3.5l4.5 4.5-4.5 4.5",
	chevd: "M3.5 6l4.5 4.5 4.5-4.5",
	up: "M8 13V3 M4 7l4-4 4 4",
	left: "M13 8H3 M7 4L3 8l4 4",
	down: "M8 3v10 M4 9l4 4 4-4",
	right: "M3 8h10 M9 4l4 4-4 4",
	archive: "M2.5 3.5h11v3h-11z M3.5 6.5v6h9v-6 M6.5 9.5h3",
	link: "M6.5 9.5l3-3 M5 7l-2 2 4 4 2-2 M11 9l2-2-4-4-2 2",
	edit: "M3 13l1-4 7-7 3 3-7 7z M9.5 3.5l3 3",
	search: "M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9z M10.4 10.4l3.1 3.1",
	history: "M5.5 2.5h5l3 3v5l-3 3h-5l-3-3v-5z M8 5v3.5l2 1.5",
	stop: "M4 4h8v8h-8z",
	retry: "M3 8a5 5 0 1 0 1.6-3.7 M3 3v3h3",
	bolt: "M9 1.5l-5 7.5h3.5l-1 5.5 5-7.5h-3.5z",
	key: "M2.5 8l3-3 3 3-3 3z M8.5 8h5 M11.5 8v2.5",
	target: "M8 1.5v4 M8 10.5v4 M1.5 8h4 M10.5 8h4",
	panel: "M2.5 3.5h11v9h-11z M6.5 3.5v9",
	settings: "M2.5 4.5h11 M2.5 11.5h11 M5.5 2.5v4 M10.5 9.5v4",
} as const;

export type IconName = keyof typeof paths | keyof typeof navPaths;

function isNav(name: IconName): name is keyof typeof navPaths {
	return name in navPaths;
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
	const nav = isNav(name);
	const base = nav ? "i n24" : "i";

	return (
		<svg
			className={className === undefined ? base : `${base} ${className}`}
			viewBox={nav ? "0 0 24 24" : "0 0 16 16"}
			aria-hidden="true"
		>
			<path d={nav ? navPaths[name] : paths[name]} />
		</svg>
	);
}

function hash(seed: string) {
	let value = 2166136261;

	for (const char of seed) {
		value ^= char.charCodeAt(0);

		value = Math.imul(value, 16777619);
	}

	return value >>> 0;
}

function avalanche(input: number) {
	let value = input;

	value ^= value >>> 16;

	value = Math.imul(value, 0x85ebca6b);

	value ^= value >>> 13;

	value = Math.imul(value, 0xc2b2ae35);

	value ^= value >>> 16;

	return value >>> 0;
}

const hues = ["lime", "cyan", "violet", "tangerine", "pink", "blue"] as const;

/** A venture's colour: one of six hues, picked from its slug so it is the same everywhere and known before the venture exists. */
export function hueOf(slug: string) {
	return `var(--h-${hues[hash(slug) % hues.length]})`;
}

/** Style that themes a subtree in a venture's colour. */
export function accent(slug: string | null | undefined) {
	return (slug === null || slug === undefined ? {} : { "--acc": hueOf(slug) }) as CSSProperties;
}

const glyphs = [
	"M7 18.5h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.7 10.6a4 4 0 0 0 1.3 7.9z M12 11.5v4.5 M10 14l2 2 2-2",
	"M5 10.5h12.5 M5.5 10.5c0 4.6 2.6 8 6.5 8s6.5-3.4 6.5-8 M9 10.5a3 3 0 0 1 6 0 M12 6v1.5 M18.4 12.2c1.6 0 2.6.9 2.6 2.1s-1 2.2-2.8 2.2 M5.7 13.2L2.8 10.8",
	"M12 12c-2-2.7-3.6-4.2-5.6-4.2a4.2 4.2 0 0 0 0 8.4c2 0 3.6-1.5 5.6-4.2c2 2.7 3.6 4.2 5.6 4.2a4.2 4.2 0 0 0 0-8.4c-2 0-3.6 1.5-5.6 4.2z",
	"M12 7.6a4.4 4.4 0 1 0 0 8.8a4.4 4.4 0 0 0 0-8.8z M7.9 9.4C4.6 10.6 2.6 12.3 3.1 13.6c.7 1.8 5.8 1.6 11.3-.5s9.4-5.2 8.7-7c-.4-1.1-2.5-1.3-5.3-.8",
	"M2.5 19h19 M4 19l6-10 4.2 6.5 M11.8 11.8l2.6-3.8 6.1 11 M8.2 12.5l1.8 1.2 1.6-1.4",
	"M12 3.5l8.5 15.5h-17z M12 9.5v9.5",
	"M3 10c3-3 6 3 9 0s6-3 9 0 M3 15.5c3-3 6 3 9 0s6-3 9 0",
	"M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17z M15.5 8.5l-2 5-5 2 2-5z",
	"M5 19c0-8 5-13 14-14c-1 9-6 14-14 14z M5 19l7-7",
	"M12 3.5l8.5 4.5-8.5 4.5-8.5-4.5z M3.5 12l8.5 4.5 8.5-4.5 M3.5 16l8.5 4.5 8.5-4.5",
	"M9.5 3.5h5 M10.5 3.5v5.5L5 18.5a1.4 1.4 0 0 0 1.2 2h11.6a1.4 1.4 0 0 0 1.2-2L13.5 9V3.5 M7.5 14.5h9",
] as const;

/** A venture's glyph: one line drawing, picked from its slug like its hue. */
export function glyphOf(slug: string) {
	return glyphs[avalanche(hash(`${slug}·glyph`)) % glyphs.length] ?? glyphs[0];
}

/** The light tint of a venture's hue, for the top of its glyph gradient. */
export function hueLightOf(slug: string) {
	return `var(--h-${hues[hash(slug) % hues.length]}-light)`;
}

export type VentureTone = "needs" | "live" | "wait";

/** A glass tile with one of the navigation glyphs in a given colour, for figures such as the Holding's stats. */
export function IconTile({
	name,
	hue,
	light,
	size = 40,
}: {
	name: keyof typeof navPaths;
	hue: string;
	light: string;
	size?: number;
}) {
	return <Tile glyph={navPaths[name]} hue={hue} light={light} size={size} tone={null} />;
}

function Tile({
	glyph,
	hue,
	light,
	size,
	tone,
}: {
	glyph: string;
	hue: string;
	light: string;
	size: number;
	tone: VentureTone | null;
}) {
	const id = useId();

	if (size < 20) {
		return (
			<svg
				className="appglyph"
				width={size}
				height={size}
				viewBox="0 0 24 24"
				style={{ color: hue }}
				aria-hidden="true"
			>
				<path d={glyph} />
			</svg>
		);
	}

	return (
		<span className="appico" style={{ "--s": `${size}px`, "--hue": hue } as CSSProperties}>
			<svg viewBox="0 0 64 64" aria-hidden="true">
				<defs>
					<linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#25222e" />
						<stop offset="1" stopColor="#121018" />
					</linearGradient>
					<linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0.35" stopColor={hue} stopOpacity="0" />
						<stop offset="1" stopColor={hue} stopOpacity="0.26" />
					</linearGradient>
					<linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#fff" stopOpacity="0.2" />
						<stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
						<stop offset="1" stopColor={hue} stopOpacity="0.35" />
					</linearGradient>
					<linearGradient id={`${id}g`} x1="0" y1="0" x2="0.4" y2="1">
						<stop offset="0" stopColor={light} />
						<stop offset="1" stopColor={hue} />
					</linearGradient>
				</defs>
				<rect x="1" y="1" width="62" height="62" rx="16" fill="#07060b" />
				<rect x="4" y="4" width="56" height="56" rx="13.5" fill={`url(#${id}b)`} />
				<rect x="4" y="4" width="56" height="56" rx="13.5" fill={`url(#${id}w)`} />
				<rect x="4.5" y="4.5" width="55" height="55" rx="13" fill="none" stroke={`url(#${id}e)`} />
				<path
					d={glyph}
					transform="translate(12.2 12.2) scale(1.65)"
					fill="none"
					stroke={`url(#${id}g)`}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			{tone === null ? null : <i className="sdot" data-tone={tone} />}
		</span>
	);
}

/** A venture's app icon: a dark glass tile with its hue and glyph, both drawn from its slug, and an optional state dot. */
export function AppIcon({ slug, size = 40, tone = null }: { slug: string; size?: number; tone?: VentureTone | null }) {
	return <Tile glyph={glyphOf(slug)} hue={hueOf(slug)} light={hueLightOf(slug)} size={size} tone={tone} />;
}

/** The Holding's app icon. */
export function HoldingIcon({ size = 40 }: { size?: number }) {
	return <Tile glyph={navPaths.holding} hue="var(--holding)" light="var(--holding-light)" size={size} tone={null} />;
}

/** An agent's mark: an open ring around a core, round for Claude Agent SDK agents and square for Pi agents. The ring turns while it runs. */
export function Drone({ square = false, size = 18, run = false }: { square?: boolean; size?: number; run?: boolean }) {
	return (
		<svg className={run ? "drone run" : "drone"} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
			<path className="ring" d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" />
			{square ? (
				<rect className="core" x="5.6" y="5.6" width="4.8" height="4.8" />
			) : (
				<circle className="core" cx="8" cy="8" r="2.7" />
			)}
		</svg>
	);
}

export function isSquare(agent: Pick<AgentOverview, "runtime"> | undefined) {
	return agent?.runtime === "pi";
}

/** The owner's mark. */
export function You({ size = 16 }: { size?: number }) {
	return (
		<svg className="you" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 3.4l4.6 4.6-4.6 4.6-4.6-4.6z" />
		</svg>
	);
}

export type DiaStatus = WorkStatus | "open" | "won" | "lost";

/** The status diamond for work (`todo`, `doing`, `done`), an open bet, and outcomes (`won`, `lost`). */
export function Dia({ status }: { status: DiaStatus }) {
	return (
		<svg className={`dia ${status}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
			<path d="M6 1l5 5-5 5-5-5z" />
			{status === "doing" ? <path className="h" d="M6 1l-5 5 5 5z" /> : null}
			{status === "open" ? <path className="h" d="M6 4.3l1.7 1.7-1.7 1.7-1.7-1.7z" /> : null}
			{status === "done" || status === "won" ? <path className="c" d="M3.7 6.1l1.6 1.6 3-3.1" /> : null}
			{status === "lost" ? <path className="x" d="M4.3 4.3l3.4 3.4 M7.7 4.3l-3.4 3.4" /> : null}
		</svg>
	);
}

export function progressStatus(progress: { done: number; total: number } | undefined) {
	if (progress === undefined || progress.done === 0) return "todo" satisfies WorkStatus;

	return progress.done === progress.total ? ("done" satisfies WorkStatus) : ("doing" satisfies WorkStatus);
}

const rankBars = { none: 0, low: 1, medium: 2, high: 3, urgent: 3 } satisfies Record<WorkPriority, number>;

export function Rank({ priority }: { priority: WorkPriority }) {
	const bars = rankBars[priority];

	return (
		<svg
			className={`rank ${priority}`}
			width="12"
			height="12"
			viewBox="0 0 12 12"
			role="img"
			aria-label={`Priority ${priority}`}
		>
			{bars === 0 ? (
				<path d="M4 6h4" />
			) : (
				[0, 1, 2].slice(0, bars).map((bar) => <path key={bar} d={`M2.5 ${10.5 - bar * 3.5}l3.5-2.5 3.5 2.5`} />)
			)}
		</svg>
	);
}

const functionGlyphs = {
	product: { code: "PRD", shape: <path d="M4 0l4 4-4 4-4-4z" /> },
	design: { code: "DSG", shape: <path d="M4 .5l4 7H0z" /> },
	engineering: { code: "ENG", shape: <path d="M0 0h8v8H0z" /> },
	marketing: { code: "MKT", shape: <circle cx="4" cy="4" r="4" /> },
	sales: { code: "SLS", shape: <path d="M0 0l8 4-8 4z" /> },
	ops: { code: "OPS", shape: <path d="M2 0h4l2 4-2 4H2L0 4z" /> },
} satisfies Record<WorkFunction, { code: string; shape: React.ReactNode }>;

export function FunctionGlyph({ fn }: { fn: WorkFunction }) {
	return (
		<svg viewBox="0 0 8 8" width="7" height="7" fill="currentColor" aria-hidden="true">
			{functionGlyphs[fn].shape}
		</svg>
	);
}

export function FunctionTag({ fn, label }: { fn: WorkFunction; label: string }) {
	return (
		<span className="tag fn" data-tip={label}>
			<FunctionGlyph fn={fn} />
			{functionGlyphs[fn].code}
		</span>
	);
}

const maxPips = 14;

export function Pips({ done, total }: { done: number; total: number }) {
	if (total === 0) return null;

	const count = Math.min(total, maxPips);
	const lit = Math.round((done / total) * count);

	return (
		<span className="pips" role="img" aria-label={`${done} of ${total} done`}>
			{Array.from({ length: count }, (_, pip) => pip).map((pip) => (
				<i key={pip} className={pip < lit ? "d" : undefined} />
			))}
		</span>
	);
}

function elapsed(since: string, now: number) {
	const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));

	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A running clock since `since`, ticking each second. */
export function Elapsed({ since }: { since: string }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);

		return () => clearInterval(timer);
	}, []);

	return (
		<span className="t" role="timer">
			{elapsed(since, now)}
		</span>
	);
}

/** The live strip: what an agent is doing right now, with a sweep and a clock. */
export function Cast({ label, since }: { label: string; since: string }) {
	return (
		<span className="cast">
			<span>{label}</span>
			<Elapsed since={since} />
		</span>
	);
}

export function Need() {
	return <i className="need" aria-hidden="true" />;
}
