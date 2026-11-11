import { Type } from 'typebox';
import { findSkill, loadSkillCatalog, type Skill } from '@studio/agent/shared/skills';
import { defineTool, READ_ONLY, type StudioToolDefinition } from './define-tool';
import { textResult } from './utils';

export function renderSkill( name: string, userSkills: Skill[] = [] ): string {
	const skill = findSkill( name, userSkills );
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ name }` );
	}
	return skill.folder ? `${ skill.body }\n\nThe skill's folder: ${ skill.folder }` : skill.body;
}

interface SkillToolOptions {
	// Skills that need tools the host lacks.
	excluded?: string[];
	// The user's own skills, read when the tool is made.
	userSkills?: Skill[];
	// Receives each loaded skill, so the runtime can make its tools available.
	onLoad?: ( skill: Skill ) => void;
}

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely.
export function createSkillTool( {
	excluded = [],
	userSkills = [],
	onLoad,
}: SkillToolOptions = {} ): StudioToolDefinition | null {
	const catalog = loadSkillCatalog( userSkills );
	const skills = catalog.skills.filter( ( skill ) => ! excluded.includes( skill.name ) );
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
			catalog.shadowed.length > 0
				? `\n\nNot loaded, since a Studio skill has the same name: ${ catalog.shadowed.join(
						', '
				  ) }`
				: ''
		}`,
		{
			name: Type.Enum( names, { description: 'The name of the skill to load.' } ),
		},
		async ( args ) => {
			const text = renderSkill( args.name, userSkills );
			const skill = findSkill( args.name, userSkills );
			if ( skill ) onLoad?.( skill );
			return textResult(
				skill && skill.tools.length > 0
					? `${ text }\n\nNow available: ${ skill.tools.join( ', ' ) }.`
					: text
			);
		},
		{ annotations: READ_ONLY }
	);
}
