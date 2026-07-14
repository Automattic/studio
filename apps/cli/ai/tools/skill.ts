import { Type } from 'typebox';
import { findSkill, loadSkills } from 'cli/ai/skills';
import { defineTool } from './define-tool';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely.
export function createSkillTool(): AgentTool< TSchema > | null {
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
		async ( args ) => {
			const skill = findSkill( args.name );
			if ( ! skill ) {
				throw new Error( `Unknown skill: ${ args.name }` );
			}
			return {
				content: [ { type: 'text' as const, text: skill.body } ],
			};
		}
	);
}
