const units: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 3600],
	["month", 30 * 24 * 3600],
	["week", 7 * 24 * 3600],
	["day", 24 * 3600],
	["hour", 3600],
	["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function ago(iso: string, now: number) {
	const seconds = Math.round((Date.parse(iso) - now) / 1000);

	if (Math.abs(seconds) < 45) return "just now";

	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
	}

	return relative.format(Math.round(seconds / 60), "minute");
}

const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

const dateTimeFormat = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

export function formatDate(isoDate: string) {
	return dateFormat.format(new Date(`${isoDate}T00:00:00`));
}

export function formatDateTime(iso: string) {
	return dateTimeFormat.format(new Date(iso));
}

const clockFormat = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

const dayWithYearFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

export function clockTime(iso: string) {
	return clockFormat.format(new Date(iso));
}

function startOfDay(time: number) {
	const date = new Date(time);

	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayLabel(iso: string, now: number) {
	const then = new Date(iso);
	const days = Math.round((startOfDay(now) - startOfDay(then.getTime())) / (24 * 3600 * 1000));

	if (days === 0) return "Today";

	if (days === 1) return "Yesterday";

	return then.getFullYear() === new Date(now).getFullYear() ? dayFormat.format(then) : dayWithYearFormat.format(then);
}

export function shortDate(isoDate: string, now: number) {
	const date = new Date(`${isoDate}T00:00:00`);

	return date.getFullYear() === new Date(now).getFullYear() ? dayFormat.format(date) : dayWithYearFormat.format(date);
}
