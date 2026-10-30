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

/**
 * Whether the WordPress.com account is on the Automattic (`a8c`) team. Unlike the email check,
 * this asks WordPress.com, so it holds for an Automattician signed in with a personal address.
 * Any failure reads as false.
 */
export async function isAutomatticianAccount( accessToken: string ): Promise< boolean > {
	try {
		const response = await fetch( 'https://public-api.wordpress.com/rest/v1.2/read/teams', {
			headers: { Authorization: `Bearer ${ accessToken }` },
			signal: AbortSignal.timeout( 5000 ),
		} );
		if ( ! response.ok ) {
			return false;
		}
		const data = ( await response.json() ) as { teams?: { slug: string }[] };
		return data.teams?.some( ( team ) => team.slug === 'a8c' ) ?? false;
	} catch {
		return false;
	}
}
