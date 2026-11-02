import { Type } from 'typebox';
import { findSkill, loadSkillCatalog, type Skill } from '@studio/agent/node/skills';
import { defineTool, READ_ONLY, type StudioToolDefinition } from './define-tool';

export function renderSkill( name: string ): string {
	const skill = findSkill( name );
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ name }` );
	}
	return skill.folder ? `${ skill.body }\n\nThe skill's folder: ${ skill.folder }` : skill.body;
}

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely.
// `onLoad` receives each loaded skill, so the runtime can make its tools available.
export function createSkillTool( onLoad?: ( skill: Skill ) => void ): StudioToolDefinition | null {
	const { skills, shadowed } = loadSkillCatalog();
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
		`Loads a skill: the runbook for one of Studio's workflows, and the tools it brings, which are available from then on.\n\nSkills:\n${ skillIndex }${
			shadowed.length > 0
				? `\n\nNot loaded, since a Studio skill has the same name: ${ shadowed.join( ', ' ) }`
				: ''
		}`,
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
