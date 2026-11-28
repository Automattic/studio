// Which half of a headless site an "Open in…" action opens. A classic site
// only has `wordpress`, and a `frontend` request for it opens WordPress.
// Kept free of Node imports: the Desktop renderer resolves folders with it too.
export type SiteOpenTarget = 'wordpress' | 'frontend';

export function getSiteFolderForTarget(
	site: { path: string; frontend?: { path: string } },
	target: SiteOpenTarget = 'wordpress'
): string {
	return target === 'frontend' && site.frontend ? site.frontend.path : site.path;
}
