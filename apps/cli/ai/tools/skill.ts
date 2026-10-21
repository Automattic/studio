import { Type } from 'typebox';
import { renderDesignCatalogIndex } from 'cli/ai/design-catalog';
import { findSkill, loadSkills } from 'cli/ai/skills';
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
export function createSkillTool(): AgentTool< TSchema > | null {
	const skills = loadSkills();
	if ( skills.length === 0 ) return null;

	const names = skills.map( ( s ) => s.name );

	return defineTool(
		'Skill',
		"Load a skill's runbook. The skills and the work each covers are listed in the system prompt. Once loaded, the runbook's instructions apply for the rest of the work it covers.",
		{
			name: Type.Enum( names, { description: 'The name of the skill to load.' } ),
		},
		async ( args ) => ( {
			content: [ { type: 'text' as const, text: renderSkill( args.name ) } ],
		} ),
		{ annotations: READ_ONLY }
	);
}
