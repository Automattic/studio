import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

const REMOTE_SITE = { name: 'Example', url: 'https://example.wordpress.com', id: 123 };

describe( 'buildSystemPrompt — WordPress.com plan capabilities', () => {
	for ( const [ label, build ] of [
		[ 'local mode', () => buildSystemPrompt() ],
		[ 'remote mode', () => buildSystemPrompt( { remoteSite: REMOTE_SITE } ) ],
	] as const ) {
		describe( label, () => {
			it( 'directs the agent to consult plan.features.active rather than guess by tier name', () => {
				const prompt = build();
				expect( prompt ).toMatch( /plan\.features\.active/ );
				expect( prompt ).toMatch( /Do NOT assert what a specific tier name/i );
			} );

			it( 'states custom post types are not plan-gated as a feature', () => {
				const prompt = build();
				expect( prompt ).toMatch( /Custom post types are core WordPress and are not plan-gated/i );
			} );

			it( 'does not resurrect the deleted "(Personal, Premium, Business, …)" tier table', () => {
				// The previous wording lumped plugin install into all paid plans
				// (Personal, Premium, Business, eCommerce); Tess corrected that and
				// asked us not to ship hardcoded per-tier claims.
				const prompt = build();
				expect( prompt ).not.toMatch( /Paid plans[^.]*\(Personal,\s*Premium,\s*Business/i );
			} );
		} );
	}
} );
