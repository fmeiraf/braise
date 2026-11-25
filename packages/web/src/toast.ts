import { type ReactNode, useSyncExternalStore } from "react";
import type { IconName } from "./marks.tsx";

export interface Toast {
	id: number;
	body: ReactNode;
	icon: IconName;
	leaving: boolean;
}

const shownMs = 3_200;
const leaveMs = 300;

let nextId = 1;
let toasts: readonly Toast[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Toast[]) {
	toasts = next;

	for (const listener of listeners) listener();
}

/** Shows a short confirmation above the dock. It leaves by itself. */
export function toast(body: ReactNode, icon: IconName = "check") {
	const id = nextId++;

	publish([...toasts, { id, body, icon, leaving: false }]);

	setTimeout(() => {
		publish(toasts.map((item) => (item.id === id ? { ...item, leaving: true } : item)));

		setTimeout(() => publish(toasts.filter((item) => item.id !== id)), leaveMs);
	}, shownMs);
}

function subscribe(listener: () => void) {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

export function useToasts() {
	return useSyncExternalStore(subscribe, () => toasts);
}
