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
		`Load the full runbook for a workflow skill. Each skill bundles step-by-step instructions you must follow at a specific point during a build; this tool returns that runbook as a tool result so you can read and apply it.\n\nAvailable skills:\n${ skillIndex }\n\nUsage rules:\n- If the task at hand matches a skill's description, loading it is MANDATORY before starting that work — even when you think you already know the workflow. Do not work from remembered instructions.\n- Call this BEFORE you start the workflow the skill covers — not after.\n- Before calling, tell the user in one short sentence which skill you are loading and why.\n- Load only the skills the current workflow needs; do not preload others "just in case".\n- Once loaded, treat the returned instructions as part of your system prompt for the duration of that workflow. If the conversation is compacted mid-workflow, reload the skill before continuing that workflow.\n- If a skill's instructions cannot be applied cleanly to the situation, say so briefly and continue with the closest safe approach.`,
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
