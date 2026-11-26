import { readSkillsForAgent } from '@studio/common/lib/global-skills';
import { Type } from 'typebox';
import { loadSkills } from '@studio/agent/node/skills';
import { buildSystemPrompt } from '@studio/agent/node/system-prompt';
import { defineTool, READ_ONLY, type AnyStudioAgentTool } from './define-tool';
import { renderSkill, renderUserSkill, selectUserSkills } from './skill';
import { textResult } from './utils';

// The skills the agent's app offers and loads itself, such as the ones an MCP server serves to
// an app with the Skills extension: studio_instructions leaves them to the app.
export interface HostSkills {
	// Studio's own, by name.
	studio: string[];
	// The user's own, by name. Read on every call: they change while the server runs.
	user: () => Promise< string[] >;
}

// The instructions of an agent that runs Studio's tools itself, fetched on
// demand rather than sent as an MCP server's instructions, which hosts keep in
// context for every conversation and may truncate.
export function createStudioInstructionsTool(
	tools: AnyStudioAgentTool[],
	hostSkills?: HostSkills
) {
	// create-skill saves with save_skill, which only a conversation has.
	const skills = loadSkills().filter( ( skill ) => skill.name !== 'create-skill' );
	const direct = skills.filter(
		( skill ) => skill.userInvokable && ! hostSkills?.studio.includes( skill.name )
	);
	return defineTool(
		'studio_instructions',
		"Returns how to build and manage WordPress sites with the Studio tools: the rules every task follows and when to load which skill. Call it before your first WordPress site task and follow it. It also lists the skills the user saved in Studio for all their sites. With `skill`, returns that skill's runbook instead; with `user_skill`, one of the user's own." +
			( direct.length
				? ` The skills for what users ask directly:\n${ direct
						.map( ( skill ) => `- ${ skill.name }: ${ skill.description }` )
						.join( '\n' ) }`
				: '' ),
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
			const loadedByHost = ( await hostSkills?.user() ) ?? [];
			return textResult(
				buildSystemPrompt( {
					external: true,
					tools,
					hostSkills: hostSkills?.studio,
					userSkills: userSkills.filter( ( skill ) => ! loadedByHost.includes( skill.name ) ),
				} )
			);
		},
		{ annotations: READ_ONLY }
	);
}
