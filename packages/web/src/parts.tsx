import type { ReactNode } from "react";

export function Hero({ cap, title, children }: { cap: ReactNode; title: string; children?: ReactNode }) {
	return (
		<header className="hero">
			<div>
				<span className="cap">{cap}</span>
				<h1 className="h1">{title}</h1>
			</div>
			{children}
		</header>
	);
}

export function Sec({
	title,
	count,
	id,
	children,
}: {
	title: string;
	count?: number | string;
	id?: string;
	children?: ReactNode;
}) {
	return (
		<div className="sec">
			<h2 id={id}>{title}</h2>
			{count === undefined ? null : <span className="cnt">{count}</span>}
			<i className="dots" />
			{children}
		</div>
	);
}

export function Skeleton({ label, widths }: { label: string; widths: readonly number[] }) {
	return (
		<div className="skel-stack" aria-busy="true">
			<span className="vh">{label}</span>
			{widths.map((width) => (
				<span key={width} className="skel" style={{ width: `${width}%` }} />
			))}
		</div>
	);
}
