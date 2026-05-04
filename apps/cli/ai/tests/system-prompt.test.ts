import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

const REMOTE_SITE = { name: 'Example', url: 'https://example.wordpress.com', id: 123 };

describe( 'buildSystemPrompt — WordPress.com plan capabilities', () => {
	it( 'directs the remote agent to consult plan.features.active rather than guess by tier name', () => {
		const prompt = buildSystemPrompt( { remoteSite: REMOTE_SITE } );
		expect( prompt ).toMatch( /plan\.features\.active/ );
		expect( prompt ).toMatch( /Do NOT assert what a specific tier name/i );
	} );

	it( 'omits WordPress.com plan guidance from the local prompt', () => {
		// Local Studio sites have no plan concept, so the WP.com capabilities
		// block is irrelevant and would only add noise.
		const prompt = buildSystemPrompt();
		expect( prompt ).not.toMatch( /plan\.features\.active/ );
		expect( prompt ).not.toMatch( /WordPress\.com plan capabilities/i );
	} );

	for ( const [ label, build ] of [
		[ 'local mode', () => buildSystemPrompt() ],
		[ 'remote mode', () => buildSystemPrompt( { remoteSite: REMOTE_SITE } ) ],
	] as const ) {
		it( `does not resurrect the deleted "(Personal, Premium, Business, …)" tier table in ${ label }`, () => {
			// The previous wording lumped plugin install into all paid plans
			// (Personal, Premium, Business, eCommerce); Tess corrected that and
			// asked us not to ship hardcoded per-tier claims.
			const prompt = build();
			expect( prompt ).not.toMatch( /Paid plans[^.]*\(Personal,\s*Premium,\s*Business/i );
		} );
	}
} );
