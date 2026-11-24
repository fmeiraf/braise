import { useEffect, useRef, useState } from "react";
import { onFreshHint, onLocalChange } from "./live.ts";

const simmerMs = 1_800;

export function useFreshVentures() {
	const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

	useEffect(() => {
		const timers = new Set<ReturnType<typeof setTimeout>>();

		const unsubscribe = onFreshHint((ventureId) => {
			setFresh((current) => new Set(current).add(ventureId));

			const timer = setTimeout(() => {
				timers.delete(timer);

				setFresh((current) => {
					const next = new Set(current);

					next.delete(ventureId);

					return next;
				});
			}, simmerMs);

			timers.add(timer);
		});

		return () => {
			unsubscribe();

			for (const timer of timers) clearTimeout(timer);
		};
	}, []);

	return fresh;
}

interface Versioned {
	id: string;
	updatedAt?: string;
	createdAt: string;
}

export function useFreshIds(ventureId: string | undefined, items: readonly Versioned[]) {
	const remoteChange = useRef(false);
	const previous = useRef<Map<string, string> | null>(null);
	const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
	const signature = items.map((item) => `${item.id}@${item.updatedAt ?? item.createdAt}`).join("|");

	useEffect(
		() =>
			onFreshHint((id) => {
				if (id === ventureId) remoteChange.current = true;
			}),
		[ventureId],
	);

	useEffect(
		() =>
			onLocalChange(() => {
				remoteChange.current = false;
			}),
		[],
	);

	useEffect(() => {
		const stamps = new Map(
			signature === ""
				? []
				: signature.split("|").map((entry) => {
						const at = entry.indexOf("@");

						return [entry.slice(0, at), entry.slice(at + 1)] as const;
					}),
		);

		const before = previous.current;

		previous.current = stamps;

		if (before === null || !remoteChange.current) return;

		remoteChange.current = false;

		const changed = new Set([...stamps].filter(([id, stamp]) => before.get(id) !== stamp).map(([id]) => id));

		if (changed.size > 0) setFresh(changed);
	}, [signature]);

	useEffect(() => {
		if (fresh.size === 0) return;

		const timer = setTimeout(() => setFresh(new Set()), simmerMs);

		return () => clearTimeout(timer);
	}, [fresh]);

	return fresh;
}
