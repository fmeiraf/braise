import { type CSSProperties, type ReactNode, useContext } from "react";
import { StreamContext } from "../live.ts";

function seeded(seed: number) {
	let value = seed;

	return () => {
		value = (value * 16807) % 2147483647;

		return value / 2147483647;
	};
}

const random = seeded(11);

const stars = Array.from({ length: 90 }, (_, index) => ({
	key: index,
	left: random() * 100,
	top: random() * 72,
	size: 1 + random() * 1.6,
	delay: random() * 6,
	speed: 2.4 + random() * 3,
	dim: random() < 0.35,
}));

const streamWords = { live: "Live", connecting: "Connecting", down: "Reconnecting" } as const;

/** The night sky over the Valley: stars, a shooting star now and then, and the ridge line. */
export function Sky() {
	return (
		<div className="vl-sky" aria-hidden="true">
			{stars.map((star) => (
				<i
					key={star.key}
					className={star.dim ? "vl-star dim" : "vl-star"}
					style={
						{
							left: `${star.left}%`,
							top: `${star.top}%`,
							width: `${star.size}px`,
							height: `${star.size}px`,
							"--delay": `${star.delay}s`,
							"--speed": `${star.speed}s`,
						} as CSSProperties
					}
				/>
			))}
			<i className="vl-shoot" />
			<svg className="vl-peaks" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
				<path
					d="M0 300 L0 210 L90 150 L170 196 L260 112 L350 182 L420 140 L520 210 L600 120 L690 176 L760 98 L860 168 L930 132 L1000 170 L1000 300 Z"
					fill="#1b1535"
					opacity="0.8"
				/>
				<path
					d="M0 300 L0 250 L120 200 L220 236 L330 180 L450 240 L560 196 L680 244 L800 190 L900 230 L1000 206 L1000 300 Z"
					fill="#150f2a"
					opacity="0.9"
				/>
			</svg>
		</div>
	);
}

/** The scope label over the hero, led by a dot that shows whether live updates are flowing. */
export function Kicker({ children }: { children: ReactNode }) {
	const stream = useContext(StreamContext);

	return (
		<span className="vl-kick">
			<i data-stream={stream} data-tip={`${streamWords[stream]}|live updates`} />
			{children}
		</span>
	);
}

export function Legend() {
	return (
		<div className="vl-legend" aria-hidden="true">
			<span>
				<i className="pip" data-tone="needs" />
				Needs you
			</span>
			<span>
				<i className="pip vl-any-hue" />
				Running
			</span>
			<span>
				<i className="pip" data-tone="wait" />
				Queued
			</span>
		</div>
	);
}

/** The attention line: how many things wait on the owner. */
export function Attention({ count }: { count: number }) {
	if (count === 0) return <p className="vl-att quiet">Nothing needs you.</p>;

	return (
		<p className="vl-att">
			<b>{count}</b>
			<span>{count === 1 ? "thing needs your attention." : "things need your attention."}</span>
		</p>
	);
}
