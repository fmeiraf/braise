import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { accent, type VentureTone } from "../marks.tsx";
import { toneWords } from "../venture-state.ts";
import type { GridSize, Plot } from "./layout.ts";
import { grounds, sprites } from "./sprites.ts";

const percent = (value: number, whole: number) => `${((value / whole) * 100).toFixed(3)}%`;

/** The Valley: one building per venture on an isometric city block, each with a floating label in its state's tone. Without `setHot` the buildings are pictures, not links. */
export function City({
	layout,
	ventures,
	toneOf,
	hot = null,
	setHot,
}: {
	layout: { grid: GridSize; plots: readonly Plot[] };
	ventures: readonly { id: string; slug: string; name: string }[];
	toneOf: (venture: { id: string; slug: string }) => VentureTone | null;
	hot?: string | null;
	setHot?: (slug: string | null) => void;
}) {
	const { grid, plots } = layout;
	const ground = grounds[grid];
	const centre = ground.lots.reduce((sum, lot) => [sum[0] + lot.at[0], sum[1] + lot.at[1]], [0, 0]);
	const lotAt = (i: number, j: number) => ground.lots.find((lot) => lot.i === i && lot.j === j)?.at ?? [0, 0];

	const box = (at: readonly number[], sprite: (typeof sprites)[keyof typeof sprites]) =>
		({
			left: percent((at[0] ?? 0) - sprite.origin[0], ground.w),
			top: percent((at[1] ?? 0) - sprite.origin[1], ground.h),
			width: percent(sprite.w, ground.w),
		}) satisfies CSSProperties;

	return (
		<div
			className="vl-city"
			style={
				{
					"--gw": `${ground.w}px`,
					aspectRatio: `${ground.w} / ${ground.h}`,
					"--cx": percent(centre[0] / ground.lots.length, ground.w),
					"--cy": percent(centre[1] / ground.lots.length, ground.h),
				} as CSSProperties
			}
		>
			<img className="vl-ground" src={`/valley/ground-${grid}.webp`} alt="" draggable={false} />
			{plots.map((plot) => {
				const sprite = sprites[plot.sprite];
				const at = lotAt(plot.i, plot.j);

				if (plot.kind !== "venture" || setHot === undefined) {
					return (
						<img
							key={`${plot.i}:${plot.j}`}
							className="vl-sprite"
							src={`/valley/${plot.sprite}.webp`}
							alt=""
							draggable={false}
							style={box(at, sprite)}
						/>
					);
				}

				const venture = ventures.find((candidate) => candidate.slug === plot.slug);
				const hit = "hit" in sprite ? sprite.hit : [];

				if (venture === undefined) return null;

				return (
					<Link
						key={plot.slug}
						to="/v/$slug"
						params={{ slug: plot.slug }}
						className={hot === plot.slug ? "vl-building hot" : "vl-building"}
						aria-label={venture.name}
						onPointerEnter={() => setHot(plot.slug)}
						onPointerLeave={() => setHot(null)}
						onFocus={() => setHot(plot.slug)}
						onBlur={() => setHot(null)}
						style={{
							...box(at, sprite),
							aspectRatio: `${sprite.w} / ${sprite.h}`,
							clipPath: `polygon(${hit.map(([x, y]) => `${percent(x, sprite.w)} ${percent(y, sprite.h)}`).join(", ")})`,
						}}
					>
						<img src={`/valley/${plot.sprite}.webp`} alt="" draggable={false} />
					</Link>
				);
			})}
			{plots.map((plot) => {
				if (plot.kind !== "venture") return null;

				const sprite = sprites[plot.sprite];
				const venture = ventures.find((candidate) => candidate.slug === plot.slug);
				const at = lotAt(plot.i, plot.j);

				if (venture === undefined || !("label" in sprite)) return null;

				const tone = toneOf(venture);

				return (
					<span
						key={plot.slug}
						className={hot === plot.slug ? "vl-label hot" : "vl-label"}
						data-tone={tone ?? "quiet"}
						aria-hidden="true"
						style={{
							...accent(plot.slug),
							left: percent((at[0] ?? 0) - sprite.origin[0] + sprite.label[0], ground.w),
							top: percent((at[1] ?? 0) - sprite.origin[1] + sprite.label[1], ground.h),
						}}
					>
						<span className="vl-chip">
							<i className="vl-pip" />
							{venture.name}
							{tone === null ? null : <b>{toneWords[tone]}</b>}
						</span>
						<i className="vl-stem" />
						<i className="vl-foot" />
					</span>
				);
			})}
		</div>
	);
}
