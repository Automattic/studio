/**
 * Normalize a Blueprint `landingPage` value for storage.
 *
 * Accepts the raw value from a Blueprint and returns a path safe to persist,
 * or `undefined` if the value is missing or unusable. We only store paths
 * (the host comes from the running site server), and we ensure they begin
 * with a leading slash so they resolve correctly against the site URL.
 */
export function normalizeLandingPage( value: unknown ): string | undefined {
	if ( typeof value !== 'string' ) {
		return undefined;
	}
	const trimmed = value.trim();
	if ( ! trimmed ) {
		return undefined;
	}
	// Strip an absolute URL down to its path + query + hash, since the host
	// is determined by the local site server, not the Blueprint author.
	try {
		const parsed = new URL( trimmed );
		return `${ parsed.pathname }${ parsed.search }${ parsed.hash }` || '/';
	} catch {
		// Not a full URL — treat as a relative path.
	}
	return trimmed.startsWith( '/' ) ? trimmed : `/${ trimmed }`;
}
