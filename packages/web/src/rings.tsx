const ringHues = 8;

/** Picks a venture's ring hue (1–8) from its id, so the same venture keeps its colour everywhere. */
export function ringHue(id: string) {
	let hash = 0;

	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

	return (hash % ringHues) + 1;
}

/** CSS custom property value for a venture's ring hue. */
export function ringColor(id: string) {
	return `var(--braise-ring-${ringHue(id)})`;
}

function arc(cx: number, cy: number, r: number, start: number, sweep: number) {
	const a0 = (start * Math.PI) / 180;
	const a1 = ((start + sweep) * Math.PI) / 180;
	const large = sweep > 180 ? 1 : 0;

	return `M${(cx + r * Math.cos(a0)).toFixed(2)} ${(cy + r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 ${large} 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}`;
}

const outerArc = arc(32, 32, 27.6, -28, 322);

/** The braise growth-ring mark. `live` makes the outer ring keep drawing itself. */
export function BraiseMark({ size = 28, live = false }: { size?: number; live?: boolean }) {
	return (
		<svg className={live ? "mark is-live" : "mark"} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
			<circle cx="24.5" cy="39.5" r="5" className="mark-pith" />
			<circle cx="26.6" cy="37.2" r="11" className="mark-ring" opacity=".55" />
			<circle cx="29.2" cy="34.6" r="18.6" className="mark-ring" opacity=".85" />
			<path d={outerArc} className="mark-outer" pathLength={100} />
		</svg>
	);
}

/** A venture's small ring glyph: its hue, one ring per strategy version (up to two), and a turning outer ring while an agent works. */
export function VentureRings({
	id,
	version = 1,
	live,
	quiet,
}: {
	id: string;
	version?: number;
	live: boolean;
	quiet: boolean;
}) {
	const classes = ["venture-rings", live ? "is-live" : "", quiet ? "is-quiet" : ""].join(" ");

	return (
		<svg
			className={classes}
			style={{ color: ringColor(id) }}
			width="18"
			height="18"
			viewBox="0 0 20 20"
			aria-hidden="true"
		>
			<circle cx="8.6" cy="11.4" r="2.2" fill="currentColor" />
			{version >= 2 ? <circle cx="9.3" cy="10.7" r="5" className="venture-rings-inner" /> : null}
			<circle cx="10" cy="10" r="8.2" className="venture-rings-outer" />
		</svg>
	);
}

const sampleRings = 3;

/**
 * A venture's core sample: one ring per strategy version (up to eight, never fewer than three drawn,
 * unreached ones as faint ghosts) around an off-centre pith in the venture's hue. While an agent
 * works, a resin ring grows around it.
 */
export function CoreSample({
	id,
	version,
	live,
	size = 92,
}: {
	id: string;
	version: number;
	live: boolean;
	size?: number;
}) {
	const reached = Math.max(0, Math.min(version, 8));
	const count = Math.max(reached, sampleRings);
	const step = 31 / count;

	return (
		<svg
			className={live ? "core-sample is-live" : "core-sample"}
			style={{ color: ringColor(id) }}
			width={size}
			height={size}
			viewBox="0 0 100 100"
			role="img"
			aria-label={`Strategy version ${version}${live ? ", an agent is working" : ""}`}
		>
			<circle cx="39" cy="60" r="7" fill="currentColor" />
			{Array.from({ length: count }, (_, index) => index + 1).map((ring) => {
				const t = ring / count;

				return (
					<circle
						key={ring}
						cx={39 + 11 * t}
						cy={60 - 10 * t}
						r={7 + step * ring}
						className={ring <= reached ? "core-ring" : "core-ring is-ghost"}
						opacity={ring <= reached ? 0.4 + 0.6 * (ring / reached) : undefined}
					/>
				);
			})}
			<circle cx="50" cy="50" r="45" className="core-growth" pathLength={100} />
		</svg>
	);
}

/** A slim progress bar in the venture's ring hue. */
export function Progress({ done, total }: { done: number; total: number }) {
	const share = total === 0 ? 0 : Math.round((done / total) * 100);

	return (
		<span className="progress" aria-hidden="true">
			<span className="progress-fill" style={{ width: `${share}%` }} />
		</span>
	);
}
