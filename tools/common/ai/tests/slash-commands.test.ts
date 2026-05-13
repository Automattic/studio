import { describe, expect, it } from 'vitest';
import { AI_SKILL_COMMANDS, buildSkillInvocationPrompt } from '../slash-commands';

describe( 'AI_SKILL_COMMANDS', () => {
	it( 'registers the /migrate skill command', () => {
		const migrate = AI_SKILL_COMMANDS.find( ( command ) => command.name === 'migrate' );
		expect( migrate ).toBeDefined();
		expect( migrate?.description ).toBe( 'Migrate a site from a closed platform into Studio' );
	} );
} );

describe( 'buildSkillInvocationPrompt', () => {
	it( 'builds the invocation prompt for /migrate', () => {
		expect( buildSkillInvocationPrompt( 'migrate' ) ).toBe(
			'Run the /migrate skill using the Skill tool.'
		);
	} );
} );
