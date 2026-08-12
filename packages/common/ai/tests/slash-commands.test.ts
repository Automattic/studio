import { describe, expect, it } from 'vitest';
import {
	buildSkillInvocationPrompt,
	getAiSkillCommands,
	resolveSkillFromPrompt,
} from '../slash-commands';

describe( 'resolveSkillFromPrompt', () => {
	it( 'resolves the bare slash form the `studio ui` server forwards untouched', () => {
		expect( resolveSkillFromPrompt( '/rank-me-up' ) ).toBe( 'rank-me-up' );
	} );

	it( 'resolves the expanded form the desktop sends after expanding before the fork', () => {
		expect( resolveSkillFromPrompt( buildSkillInvocationPrompt( 'rank-me-up' ) ) ).toBe(
			'rank-me-up'
		);
	} );

	it( 'resolves every catalog skill in both shapes', () => {
		for ( const { name } of getAiSkillCommands() ) {
			expect( resolveSkillFromPrompt( `/${ name }` ) ).toBe( name );
			expect( resolveSkillFromPrompt( buildSkillInvocationPrompt( name ) ) ).toBe( name );
		}
	} );

	it( 'ignores surrounding whitespace', () => {
		expect( resolveSkillFromPrompt( '  /annotate  ' ) ).toBe( 'annotate' );
	} );

	it( 'returns undefined for an ordinary prompt', () => {
		expect( resolveSkillFromPrompt( 'Fix the header on my site' ) ).toBeUndefined();
	} );

	// The name is reported to analytics, so prompt text must never leak out through it.
	it( 'returns undefined for slash text that is not a known skill', () => {
		expect( resolveSkillFromPrompt( '/not-a-skill' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '/rank-me-up extra words' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '/../../etc/passwd' ) ).toBeUndefined();
	} );

	it( 'does not treat a prompt merely mentioning a skill as an invocation', () => {
		expect( resolveSkillFromPrompt( 'What does the /rank-me-up skill do?' ) ).toBeUndefined();
	} );

	it( 'returns undefined for an empty prompt', () => {
		expect( resolveSkillFromPrompt( '' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '   ' ) ).toBeUndefined();
	} );
} );
