import { Type } from 'typebox';
import { loadSkills } from '@studio/agent/node/skills';
import { buildSystemPrompt } from '@studio/agent/node/system-prompt';
import { defineTool, READ_ONLY, type AnyStudioAgentTool } from './define-tool';
import { renderSkill } from './skill';
import { textResult } from './utils';

// The instructions of an agent that runs Studio's tools itself, fetched on
// demand rather than sent as an MCP server's instructions, which hosts keep in
// context for every conversation and may truncate.
export function createStudioInstructionsTool( tools: AnyStudioAgentTool[] ) {
	const skills = loadSkills();
	return defineTool(
		'studio_instructions',
		"Returns how to build and manage WordPress sites with the Studio tools: the rules every task follows and when to load which skill. Call it before your first WordPress site task and follow it. With `skill`, returns that skill's runbook instead. The skills for what users ask directly:\n" +
			skills
				.filter( ( skill ) => skill.userInvokable )
				.map( ( skill ) => `- ${ skill.name }: ${ skill.description }` )
				.join( '\n' ),
		{
			skill: Type.Optional(
				Type.Enum(
					skills.map( ( skill ) => skill.name ),
					{ description: 'A skill the instructions name.' }
				)
			),
		},
		async ( args ) =>
			textResult(
				args.skill ? renderSkill( args.skill ) : buildSystemPrompt( { external: true, tools } )
			),
		{ annotations: READ_ONLY }
	);
}
