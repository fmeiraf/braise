export function slugify(name: string) {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64)
		.replace(/-+$/u, "");
}
