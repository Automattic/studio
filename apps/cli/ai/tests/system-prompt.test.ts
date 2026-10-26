import { describe, expect, it } from 'vitest';
import { getSkillScopedToolNames, loadSkills } from '../skills';
import { buildSystemPrompt, PROXY_IDENTITY } from '../system-prompt';
import { resolveStudioToolDefinitions } from '../tools';

describe( 'buildSystemPrompt', () => {
	// The WordPress.com AI proxy refuses any other opening with a 403.
	it( 'opens with the line the WordPress.com AI proxy admits, byte for byte', () => {
		expect( PROXY_IDENTITY ).toBe( 'You are WordPress Studio, built by Automattic.' );
		expect( buildSystemPrompt().startsWith( `${ PROXY_IDENTITY }\n\n## Environment` ) ).toBe(
			true
		);
	} );

	it( 'states identity and environment only', () => {
		for ( const prompt of [ buildSystemPrompt(), buildSystemPrompt( { external: true } ) ] ) {
			expect( prompt ).toContain( 'wp-includes/' );
			expect( prompt ).toContain( 'WordPress.com' );
			expect( prompt ).not.toMatch( /\b(MUST|never|always|do not|don't)\b/i );
			expect( prompt.length ).toBeLessThan( 1600 );
		}
	} );

	it( 'names no tool and no skill; their definitions describe themselves', () => {
		const prompt = buildSystemPrompt();
		for ( const tool of resolveStudioToolDefinitions( { emitChatArtifacts: true } ) ) {
			expect( prompt ).not.toContain( tool.name );
		}
		for ( const skill of loadSkills() ) {
			expect( prompt ).not.toContain( `\`${ skill.name }\`` );
		}
	} );

	it( 'leaves the identity to the external agent', () => {
		expect( buildSystemPrompt( { external: true } ) ).not.toContain( 'You are' );
	} );

	it( 'states the active site in its own section, above the user instructions', () => {
		const prompt = buildSystemPrompt( {
			userInstructions: 'Always answer in French.',
			activeSite: { name: 'My Site', path: '/sites/my-site', running: true },
		} );

		expect( prompt ).toContain( '## Active site\n\n"My Site" at /sites/my-site (running)' );
		expect( prompt.indexOf( '## Active site' ) ).toBeLessThan(
			prompt.indexOf( "## The user's standing instructions" )
		);
		expect( buildSystemPrompt( {} ) ).not.toContain( '## Active site' );
	} );

	it( "lists the active site's facts under it, one per line", () => {
		const prompt = buildSystemPrompt( {
			activeSite: { name: 'My Site', path: '/sites/my-site', running: true },
			activeSiteFacts: [ 'WordPress 7.1.3.' ],
		} );

		expect( prompt ).toContain( '"My Site" at /sites/my-site (running)\nWordPress 7.1.3.' );
	} );

	it( 'states a WordPress.com active site with its ID and URL', () => {
		const prompt = buildSystemPrompt( {
			activeSite: {
				name: 'Live',
				path: '',
				running: false,
				remote: { host: 'wpcom', id: 123 },
				url: 'https://example.wordpress.com',
			},
		} );

		expect( prompt ).toContain(
			'## Active site\n\n"Live" (ID: 123) at https://example.wordpress.com (WordPress.com)'
		);
	} );

	it( 'appends the user standing instructions when set', () => {
		const prompt = buildSystemPrompt( { userInstructions: 'Always answer in French.' } );
		expect( prompt ).toContain( "## The user's standing instructions" );
		expect( prompt ).toContain( 'Always answer in French.' );
		expect( buildSystemPrompt() ).not.toContain( 'standing instructions' );
	} );

	it( 'truncates oversized standing instructions with a visible notice', () => {
		const prompt = buildSystemPrompt( { userInstructions: 'a'.repeat( 20_000 ) } );
		expect( prompt ).toContain( 'truncated here' );
		expect( prompt ).not.toContain( 'a'.repeat( 17_000 ) );
	} );
} );

describe( 'skill-scoped tools', () => {
	it( 'every tool a skill brings is a Studio tool', () => {
		const known = new Set( [
			...resolveStudioToolDefinitions( { emitChatArtifacts: true, imageGeneration: true } ).map(
				( tool ) => tool.name
			),
			'present_design_options',
		] );
		for ( const name of getSkillScopedToolNames() ) {
			expect( known ).toContain( name );
		}
	} );
} );
