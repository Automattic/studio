import { describe, expect, it } from 'vitest';
import { AI_SKILL_COMMANDS, buildSkillInvocationPrompt } from '../slash-commands';

describe( 'buildSkillInvocationPrompt', () => {
	it( 'invokes the skill matching the command name', () => {
		expect( buildSkillInvocationPrompt( 'liberate' ) ).toBe(
			'Run the /liberate skill using the Skill tool.'
		);
	} );

	it( 'resolves alias commands to their target skill', () => {
		expect( buildSkillInvocationPrompt( 'migrate' ) ).toBe(
			'Run the /liberate skill using the Skill tool.'
		);
	} );

	it( 'falls back to the given name for unknown commands', () => {
		expect( buildSkillInvocationPrompt( 'unknown-skill' ) ).toBe(
			'Run the /unknown-skill skill using the Skill tool.'
		);
	} );

	it( 'aliases point at a skill provided by another command', () => {
		const names = new Set( AI_SKILL_COMMANDS.map( ( cmd ) => cmd.name ) );
		for ( const cmd of AI_SKILL_COMMANDS ) {
			if ( cmd.skill ) {
				expect( names ).toContain( cmd.skill );
			}
		}
	} );
} );
