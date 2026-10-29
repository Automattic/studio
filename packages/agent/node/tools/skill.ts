import { Type } from 'typebox';
import { renderDesignCatalogIndex } from '@studio/agent/node/design-catalog';
import { findSkill, loadSkills } from '@studio/agent/node/skills';
import { defineTool, READ_ONLY, type StudioToolDefinition } from './define-tool';

export function renderSkill( name: string ): string {
	const skill = findSkill( name );
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ name }` );
	}
	return renderDesignCatalogIndex( skill.body );
}

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely.
export function createSkillTool(): StudioToolDefinition | null {
	const skills = loadSkills();
	if ( skills.length === 0 ) return null;

	const skillIndex = skills.map( ( s ) => `- ${ s.name }: ${ s.description }` ).join( '\n' );
	const names = skills.map( ( s ) => s.name );

	return defineTool(
		'Skill',
		`Load the full runbook for a workflow skill. Each skill bundles step-by-step instructions you must follow at a specific point during a build; this tool returns that runbook as a tool result so you can read and apply it.\n\nAvailable skills:\n${ skillIndex }\n\nCall this BEFORE you start the workflow the skill covers — not after. Once loaded, treat the returned instructions as part of your system prompt for the duration of that workflow.`,
		{
			name: Type.Enum( names, { description: 'The name of the skill to load.' } ),
		},
		async ( args ) => ( {
			content: [ { type: 'text' as const, text: renderSkill( args.name ) } ],
		} ),
		{ annotations: READ_ONLY }
	);
}
