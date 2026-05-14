import { describe, expect, it } from 'vitest';
import { AI_SKILL_COMMANDS, buildSkillInvocationPrompt } from '../slash-commands';

describe( 'AI_SKILL_COMMANDS', () => {
	it( 'registers the /liberate skill command', () => {
		const liberate = AI_SKILL_COMMANDS.find( ( command ) => command.name === 'liberate' );
		expect( liberate ).toBeDefined();
		expect( liberate?.description ).toBe( 'Liberate a site from a closed platform into Studio' );
	} );
} );

describe( 'buildSkillInvocationPrompt', () => {
	it( 'builds the invocation prompt for /liberate', () => {
		expect( buildSkillInvocationPrompt( 'liberate' ) ).toBe(
			'Run the /liberate skill using the Skill tool.'
		);
	} );
} );
