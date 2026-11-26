import { readUserSkillInstructions, type UserSkill } from '@studio/common/lib/user-skills';
import { Type } from 'typebox';
import { renderDesignCatalogIndex } from '@studio/agent/node/design-catalog';
import { findSkill, loadSkills } from '@studio/agent/node/skills';
import { defineTool, READ_ONLY, type StudioToolDefinition } from './define-tool';
import type { ToolResultSkill } from '@studio/agent/protocol/tools';

export function renderSkill( name: string ): string {
	const skill = findSkill( name );
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ name }` );
	}
	return renderDesignCatalogIndex( skill.body );
}

export async function renderUserSkill( skill: UserSkill ): Promise< string > {
	const instructions = await readUserSkillInstructions( skill );
	return `This skill is the user's own, in ${ skill.directory }. The files its instructions name are in that folder.\n\n${ instructions }`;
}

// The user's skills an agent can pick: Studio's names are reserved, and a skill without a
// description gives the model nothing to pick it by.
export const selectUserSkills = ( userSkills: UserSkill[] ): UserSkill[] =>
	userSkills.filter( ( skill ) => skill.description && ! findSkill( skill.name ) );

const renderIndex = ( skills: { name: string; description: string }[] ) =>
	skills.map( ( skill ) => `- ${ skill.name }: ${ skill.description }` ).join( '\n' );

// Returns `null` when no skills are discovered so the caller skips
// registering the tool entirely. `excluded` skills need tools the host lacks.
// `userSkills` are the user's own, for the active site and for all sites.
export function createSkillTool(
	excluded: string[] = [],
	userSkills: UserSkill[] = []
): StudioToolDefinition | null {
	const skills = loadSkills().filter( ( skill ) => ! excluded.includes( skill.name ) );
	if ( skills.length === 0 ) return null;

	const ownSkills = selectUserSkills( userSkills );
	const ownIndex = ownSkills.length
		? `The user's own skills:\n${ renderIndex(
				ownSkills
		  ) }\n\nLoad one of the user's own skills when the request matches its description, or when the user's message starts with \`/\` and its name.\n\n`
		: '';
	const names = [ ...skills, ...ownSkills ].map( ( skill ) => skill.name );

	return defineTool(
		'Skill',
		`Load the full runbook for a workflow skill. Each skill bundles step-by-step instructions you must follow at a specific point during a build; this tool returns that runbook as a tool result so you can read and apply it.\n\nAvailable skills:\n${ renderIndex(
			skills
		) }\n\n${ ownIndex }Call this BEFORE you start the workflow the skill covers — not after. Once loaded, treat the returned instructions as part of your system prompt for the duration of that workflow.`,
		{
			name: Type.Enum( names, { description: 'The name of the skill to load.' } ),
		},
		async ( args ) => {
			const ownSkill = ownSkills.find( ( skill ) => skill.name === args.name );
			const text = ownSkill ? await renderUserSkill( ownSkill ) : renderSkill( args.name );
			const skill: ToolResultSkill = {
				name: args.name,
				description: ( ownSkill ?? findSkill( args.name ) )?.description ?? '',
			};
			return { content: [ { type: 'text' as const, text } ], details: { skill } };
		},
		{ annotations: READ_ONLY }
	);
}
