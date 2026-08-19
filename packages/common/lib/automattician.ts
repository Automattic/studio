/**
 * Automattician detection from a WordPress.com account email.
 *
 * Kept in its own leaf module — with no Node imports — so sandboxed renderers
 * can share it with `shared-config.ts`, which reads the token off disk and
 * therefore can't be imported from the renderer.
 *
 * This is a heuristic: an Automattician whose WordPress.com account uses a
 * personal address reads as false. Use it to decide what to *show*, never as
 * an access control — that has to live server-side, where the real identity is.
 */
export function isAutomatticianEmail( email: string | undefined | null ): boolean {
	const normalized = email?.toLowerCase() ?? '';
	return normalized.endsWith( '@a8c.com' ) || normalized.endsWith( '@automattic.com' );
}
