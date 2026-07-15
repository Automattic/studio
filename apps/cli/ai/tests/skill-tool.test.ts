import { describe, expect, it } from 'vitest';
import { loadSkills } from '../skills';
import { createSkillTool } from '../tools/skill';

describe( 'createSkillTool', () => {
	it( 'lists every bundled skill in the tool description', () => {
		const tool = createSkillTool();

		expect( tool ).not.toBeNull();
		for ( const skill of loadSkills() ) {
			expect( tool!.description ).toContain( `- ${ skill.name }: ` );
		}
	} );

	it( 'states the operational usage rules', () => {
		const tool = createSkillTool();

		expect( tool ).not.toBeNull();
		expect( tool!.description ).toContain( 'Usage rules:' );
		expect( tool!.description ).toContain( 'loading it is MANDATORY' );
		expect( tool!.description ).toContain( 'tell the user in one short sentence which skill' );
		expect( tool!.description ).toContain( 'do not preload others' );
		expect( tool!.description ).toContain(
			'If the conversation is compacted mid-workflow, reload the skill'
		);
		expect( tool!.description ).toContain( 'continue with the closest safe approach' );
	} );

	it( 'returns the skill body when executed', async () => {
		const tool = createSkillTool();
		const [ firstSkill ] = loadSkills();

		expect( tool ).not.toBeNull();
		expect( firstSkill ).toBeTruthy();
		const result = await tool!.execute(
			'skill-call-1',
			{ name: firstSkill.name },
			new AbortController().signal
		);
		expect( result.content ).toEqual( [ { type: 'text', text: firstSkill.body } ] );
	} );
} );
