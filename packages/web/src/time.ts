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
