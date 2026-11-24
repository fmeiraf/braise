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

/** A venture's small ring glyph: its hue, and a turning outer ring while an agent works on it. */
export function VentureRings({ id, live, quiet }: { id: string; live: boolean; quiet: boolean }) {
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
			<circle cx="9" cy="11" r="2.2" fill="currentColor" />
			<circle cx="9.6" cy="10.5" r="5" className="venture-rings-inner" />
			<circle cx="10" cy="10" r="8.2" className="venture-rings-outer" />
		</svg>
	);
}

/**
 * The cockpit's core sample: one ring per strategy version (up to eight), drawn around an
 * off-centre pith in the venture's hue. While an agent works, a resin ring grows around it.
 */
export function CoreSample({ id, version, live }: { id: string; version: number; live: boolean }) {
	const count = Math.max(1, Math.min(version, 8));
	const step = 30 / count;

	return (
		<svg
			className={live ? "core-sample is-live" : "core-sample"}
			style={{ color: ringColor(id) }}
			width="84"
			height="84"
			viewBox="0 0 100 100"
			role="img"
			aria-label={`Strategy version ${version}${live ? ", an agent is working" : ""}`}
		>
			<circle cx="43" cy="56" r="7" fill="currentColor" />
			{Array.from({ length: count }, (_, index) => index + 1).map((ring) => {
				const t = ring / count;

				return (
					<circle
						key={ring}
						cx={43 + 7 * t}
						cy={56 - 6 * t}
						r={7 + step * ring}
						className="core-ring"
						opacity={0.35 + 0.6 * t}
					/>
				);
			})}
			<circle cx="50" cy="50" r="45" className="core-growth" pathLength={100} />
		</svg>
	);
}
