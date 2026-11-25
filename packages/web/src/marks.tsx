import type { AgentOverview, BetStatus, WorkFunction, WorkPriority, WorkStatus } from "@braise/core";
import { type CSSProperties, useEffect, useState } from "react";

const paths = {
	overview: "M2.5 2.5h5v6h-5z M9.5 2.5h4v3h-4z M9.5 7.5h4v6h-4z M2.5 10.5h5v3h-5z",
	work: "M3 2.5v10.5h3.5 M3 7.5h3.5 M3 2.5h3.5 M9 2.5h4.5 M9 7.5h4.5 M9 13h4.5",
	threads: "M2.5 3.5h11v7h-6l-3 3v-3h-2z",
	activity: "M1.5 8.5h3l2-5 3 9 2-4h3",
	inbox: "M2.5 9.5l2-6h7l2 6v3h-11z M2.5 9.5h3.5l1 1.5h2l1-1.5h3.5",
	agents: "M8 2l6 6-6 6-6-6z M6.5 8h3",
	holding: "M8 2.5l6 3-6 3-6-3z M2 9l6 3 6-3",
	plus: "M8 3v10 M3 8h10",
	x: "M4 4l8 8 M12 4l-8 8",
	check: "M3 8.5l3.5 3.5 6.5-7",
	chevr: "M6 3.5l4.5 4.5-4.5 4.5",
	chevd: "M3.5 6l4.5 4.5 4.5-4.5",
	up: "M8 13V3 M4 7l4-4 4 4",
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
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
	return (
		<svg className={className === undefined ? "i" : `i ${className}`} viewBox="0 0 16 16" aria-hidden="true">
			<path d={paths[name]} />
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

const hues = ["lime", "cyan", "violet", "tangerine", "pink", "blue"] as const;

/** A venture's colour: one of six hues, picked from its slug so it is the same everywhere and known before the venture exists. */
export function hueOf(slug: string) {
	return `var(--h-${hues[hash(slug) % hues.length]})`;
}

/** Style that themes a subtree in a venture's colour. */
export function accent(slug: string | null | undefined) {
	return (slug === null || slug === undefined ? {} : { "--acc": hueOf(slug) }) as CSSProperties;
}

function crestDots(seed: string, offset: number) {
	let bits = hash(`${seed}·braise`);
	let set = 0;

	for (let bit = 0; bit < 15; bit++) set += (bits >>> bit) & 1;

	if (set < 7) bits = ~bits >>> 0;

	const dots: { key: string; cx: number; cy: number; twinkle: boolean }[] = [];

	for (let y = 0; y < 5; y++) {
		for (let x = 0; x < 3; x++) {
			const on = ((bits >>> (y * 3 + x)) & 1) === 1 || (x === 2 && (y === 1 || y === 3));

			if (!on) continue;

			const twinkle = ((bits >>> (x + y * 2)) & 3) === 0;

			dots.push({ key: `${x}:${y}`, cx: x + 0.5 + offset, cy: y + 0.5 + offset, twinkle });

			if (x < 2) dots.push({ key: `${4 - x}:${y}`, cx: 4.5 - x + offset, cy: y + 0.5 + offset, twinkle });
		}
	}

	return dots;
}

/** A venture's crest: a symmetric dot pattern drawn from its slug. `live` makes some dots twinkle while an agent works. */
export function Crest({ seed, size = 22, live = false }: { seed: string; size?: number; live?: boolean }) {
	const tile = size >= 28;
	const offset = tile ? 1.15 : 0;
	const box = 5 + offset * 2;

	return (
		<svg
			className={live ? "crest live" : "crest"}
			width={size}
			height={size}
			viewBox={`0 0 ${box} ${box}`}
			aria-hidden="true"
		>
			{tile ? (
				<rect className="tile" x=".04" y=".04" width={box - 0.08} height={box - 0.08} rx={box * 0.26} />
			) : null}
			{crestDots(seed, offset).map((dot) => (
				<circle key={dot.key} className={dot.twinkle ? "tw" : undefined} cx={dot.cx} cy={dot.cy} r=".44" />
			))}
		</svg>
	);
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

/** The status diamond for work (`todo`, `doing`, `done`) and bets (`open`, `won`, `lost`, `killed`). */
export function Dia({ status }: { status: WorkStatus | BetStatus }) {
	return (
		<svg className={`dia ${status}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
			<path d="M6 1l5 5-5 5-5-5z" />
			{status === "doing" ? <path className="h" d="M6 1l-5 5 5 5z" /> : null}
			{status === "open" ? <path className="h" d="M6 4.3l1.7 1.7-1.7 1.7-1.7-1.7z" /> : null}
			{status === "done" || status === "won" ? <path className="c" d="M3.7 6.1l1.6 1.6 3-3.1" /> : null}
			{status === "lost" || status === "killed" ? (
				<path className="x" d="M4.3 4.3l3.4 3.4 M7.7 4.3l-3.4 3.4" />
			) : null}
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
