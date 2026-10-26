import { Type } from 'typebox';
import { renderDesignCatalogIndex } from 'cli/ai/design-catalog';
import { findSkill, loadSkills, type Skill } from 'cli/ai/skills';
import { defineTool, READ_ONLY } from './define-tool';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

export function renderSkill( name: string ): string {
	const skill = findSkill( name );
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ name }` );
	}
	return renderDesignCatalogIndex( skill.body );
}

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely.
// `onLoad` receives each loaded skill, so the runtime can make its tools available.
export function createSkillTool( onLoad?: ( skill: Skill ) => void ): AgentTool< TSchema > | null {
	const skills = loadSkills();
	if ( skills.length === 0 ) return null;

	const skillIndex = skills
		.map(
			( s ) =>
				`- ${ s.name }: ${ s.description }${
					s.tools.length > 0 ? ` (brings ${ s.tools.join( ', ' ) })` : ''
				}`
		)
		.join( '\n' );
	const names = skills.map( ( s ) => s.name );

	return defineTool(
		'Skill',
		`Loads a skill: the runbook for one of Studio's workflows, and the tools it brings, which are available from then on. Loading one is a step of your own, as reading a file is; the user sees the work it does.\n\nSkills:\n${ skillIndex }`,
		{
			name: Type.Enum( names, { description: 'The name of the skill to load.' } ),
		},
		async ( args ) => {
			const text = renderSkill( args.name );
			const skill = findSkill( args.name );
			if ( skill ) onLoad?.( skill );
			return {
				content: [
					{
						type: 'text' as const,
						text:
							skill && skill.tools.length > 0
								? `${ text }\n\nNow available: ${ skill.tools.join( ', ' ) }.`
								: text,
					},
				],
			};
		},
		{ annotations: READ_ONLY }
	);
}
