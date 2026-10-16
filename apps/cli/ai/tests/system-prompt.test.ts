import { describe, expect, it } from 'vitest';
import { getSkillScopedToolNames, loadSkills } from '../skills';
import { buildSystemPrompt, PROXY_IDENTITY } from '../system-prompt';
import { resolveStudioToolDefinitions } from '../tools';

describe( 'buildSystemPrompt', () => {
	it( 'starts with the identity paragraph the WordPress.com AI proxy requires, verbatim', () => {
		expect( buildSystemPrompt().startsWith( `${ PROXY_IDENTITY }\n` ) ).toBe( true );
	} );

	// The proxy's identity paragraph is fixed; everything Studio adds after it is fact only.
	it( 'states identity and environment only', () => {
		for ( const prompt of [
			buildSystemPrompt().slice( PROXY_IDENTITY.length ),
			buildSystemPrompt( { external: true } ),
		] ) {
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

	it( 'identifies Studio as part of Automattic, with its hosting and domain partners', () => {
		for ( const prompt of [ buildSystemPrompt(), buildSystemPrompt( { external: true } ) ] ) {
			expect( prompt ).toContain( 'Automattic' );
			expect( prompt ).toContain( 'WordPress.com and Pressable' );
			expect( prompt ).toContain( 'https://wordpress.com/domains' );
		}
		expect( buildSystemPrompt( { external: true } ) ).not.toContain( 'You are' );
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
