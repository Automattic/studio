import { describe, expect, it } from 'vitest';
import { AI_SKILL_COMMANDS, buildSkillInvocationPrompt } from '../slash-commands';

describe( 'AI_SKILL_COMMANDS', () => {
	it( 'includes a /migrate command entry', () => {
		const migrate = AI_SKILL_COMMANDS.find( ( command ) => command.name === 'migrate' );
		expect( migrate ).toBeDefined();
		expect( migrate?.description ).toBeTypeOf( 'string' );
		expect( migrate?.description.length ).toBeGreaterThan( 0 );
	} );
} );

describe( 'buildSkillInvocationPrompt', () => {
	it( 'returns the standard invocation prompt for /migrate', () => {
		expect( buildSkillInvocationPrompt( 'migrate' ) ).toBe(
			'Run the /migrate skill using the Skill tool.'
		);
	} );
} );
