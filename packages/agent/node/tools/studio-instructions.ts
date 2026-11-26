import { readSkillsForAgent } from '@studio/common/lib/global-skills';
import { Type } from 'typebox';
import { loadSkills } from '@studio/agent/node/skills';
import { buildSystemPrompt } from '@studio/agent/node/system-prompt';
import { defineTool, READ_ONLY, type AnyStudioAgentTool } from './define-tool';
import { renderSkill, renderUserSkill, selectUserSkills } from './skill';
import { textResult } from './utils';

// The instructions of an agent that runs Studio's tools itself, fetched on
// demand rather than sent as an MCP server's instructions, which hosts keep in
// context for every conversation and may truncate.
export function createStudioInstructionsTool( tools: AnyStudioAgentTool[] ) {
	// create-skill saves with save_skill, which only a conversation has.
	const skills = loadSkills().filter( ( skill ) => skill.name !== 'create-skill' );
	return defineTool(
		'studio_instructions',
		"Returns how to build and manage WordPress sites with the Studio tools: the rules every task follows and when to load which skill. Call it before your first WordPress site task and follow it. It also lists the skills the user saved in Studio for all their sites. With `skill`, returns that skill's runbook instead; with `user_skill`, one of the user's own. The skills for what users ask directly:\n" +
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
			user_skill: Type.Optional(
				Type.String( {
					description:
						"The name of one of the user's own skills, as the instructions list them. Not for the skills `skill` takes.",
				} )
			),
		},
		async ( args ) => {
			if ( args.skill ) {
				return textResult( renderSkill( args.skill ) );
			}
			// Read on every call: the user adds, changes and switches skills while the server runs.
			// An outside agent has no active site, so these are the skills for all sites; a site's
			// own are in its folder, where the agent's file tools find them.
			const userSkills = selectUserSkills( await readSkillsForAgent() );
			if ( args.user_skill ) {
				const userSkill = userSkills.find( ( candidate ) => candidate.name === args.user_skill );
				if ( ! userSkill ) {
					throw new Error(
						`The user has no skill named "${ args.user_skill }". Their skills: ${
							userSkills.map( ( candidate ) => candidate.name ).join( ', ' ) || 'none'
						}.`
					);
				}
				return textResult( await renderUserSkill( userSkill ) );
			}
			return textResult( buildSystemPrompt( { external: true, tools, userSkills } ) );
		},
		{ annotations: READ_ONLY }
	);
}
