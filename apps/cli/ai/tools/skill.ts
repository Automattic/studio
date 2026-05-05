import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { findSkill, loadSkills, type Skill } from 'cli/ai/skills';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

/**
 * Skill names the OpenAI runtime exposes to the model. The discovered set on
 * disk includes tool-shaped skills (`rank-me-up`, `need-for-speed`,
 * `taxonomist`) that map 1:1 to dedicated Studio tools — putting them here
 * would just give the model a redundant path to the same audit and tempt it
 * to run audits unprompted on every site build. So we whitelist only true
 * workflow skills the model should be able to load mid-turn.
 *
 * The Anthropic runtime gets the equivalent listing automatically through the
 * SDK's plugin/Skill machinery, so this whitelist is OpenAI-only.
 */
const VISIBLE_SKILL_NAMES = new Set( [ 'site-spec' ] );

function getVisibleSkills(): Skill[] {
	return loadSkills().filter( ( skill ) => VISIBLE_SKILL_NAMES.has( skill.name ) );
}

/**
 * Hand-rolled `Skill` tool for the OpenAI runtime.
 *
 * Mirrors the Anthropic SDK's built-in Skill tool: each visible skill is
 * advertised by name + frontmatter description in the tool description, and
 * calling the tool with a name returns the SKILL.md body as a tool result.
 * Loading the body on demand (rather than splicing it into every system
 * prompt) keeps the body's instructions focused — they arrive as a fresh
 * tool result the model just asked for, not text buried at the tail of a
 * 400-line prompt that the surrounding design vocabulary tends to drown out.
 *
 * Returns `null` when no visible skills are discovered so the caller can
 * skip registering the tool entirely.
 */
export function createSkillTool(): SdkMcpToolDefinition | null {
	const skills = getVisibleSkills();
	if ( skills.length === 0 ) return null;

	const skillIndex = skills.map( ( s ) => `- ${ s.name }: ${ s.description }` ).join( '\n' );
	const names = skills.map( ( s ) => s.name ) as [ string, ...string[] ];

	const definition = tool(
		'Skill',
		`Load the full runbook for a workflow skill. Each skill bundles step-by-step instructions you must follow at a specific point during a build; this tool returns that runbook as a tool result so you can read and apply it.\n\nAvailable skills:\n${ skillIndex }\n\nCall this BEFORE you start the workflow the skill covers — not after. Once loaded, treat the returned instructions as part of your system prompt for the duration of that workflow.`,
		{
			name: z.enum( names ).describe( 'The name of the skill to load.' ),
		},
		async ( args ) => {
			const skill = findSkill( args.name );
			if ( ! skill ) {
				return {
					content: [ { type: 'text' as const, text: `Unknown skill: ${ args.name }` } ],
					isError: true,
				};
			}
			return {
				content: [ { type: 'text' as const, text: skill.body } ],
			};
		}
	);
	return definition as unknown as SdkMcpToolDefinition;
}
