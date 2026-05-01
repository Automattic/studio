import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

describe( 'AI system prompt', () => {
	it( 'instructs local theme generation to account for the WordPress admin bar', () => {
		const prompt = buildSystemPrompt();

		expect( prompt ).toContain( 'Header/admin bar compatibility' );
		expect( prompt ).toContain( 'Fixed or sticky top headers are allowed' );
		expect( prompt ).not.toContain( 'Prefer normal-flow headers' );
		expect( prompt ).toContain( 'Never override the WordPress admin-bar `html` margin' );
		expect( prompt ).toContain( 'position: fixed' );
		expect( prompt ).toContain( 'position: sticky' );
		expect( prompt ).toContain( 'do not leave it at `top: 0`' );
		expect( prompt ).toContain( 'body.admin-bar' );
		expect( prompt ).toContain( 'html.admin-bar' );
		expect( prompt ).toContain( '32px desktop, 46px at `max-width: 782px`' );
	} );
} );
