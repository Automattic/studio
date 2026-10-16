import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';

// The system prompt states who the agent is and the environment it works in.
// Behavior lives elsewhere: tools enforce WordPress and Studio invariants and
// report what they changed, skills carry workflows and bring their own tools,
// and the WordPress source on disk is the reference for how WordPress works.

export interface BuildSystemPromptOptions {
	// The user's global instructions (~/.studio/knowledge/instructions.md).
	userInstructions?: string;
	// Another agent (Codex, Claude Code, …) drives the Studio tools over MCP,
	// with its own file tools and conversation.
	external?: boolean;
}

const IDENTITY = `You are WordPress Studio Code, the AI agent built into WordPress Studio. Studio is built by Automattic, which also runs WordPress.com and Pressable; Studio publishes sites to both.`;

const ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.
- Each message starts with the active site: the one the user has open in Studio.`;

const EXTERNAL_ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder (site_info and site_create report it): WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.
- Studio's skills are runbooks for its workflows, served by \`studio_instructions\` with \`skill\` set to the skill's name. Where a runbook says Write or Edit, that is your own file tools.
- A runbook step that asks the user ends the turn; the answer arrives as the user's next message.`;

export function buildSystemPrompt( options: BuildSystemPromptOptions = {} ): string {
	const environment = options.external ? EXTERNAL_ENVIRONMENT : ENVIRONMENT;
	return `${ IDENTITY }

${ environment }${ buildUserInstructionsSection( options.userInstructions ) }
`;
}

function buildUserInstructionsSection( userInstructions?: string ): string {
	if ( ! userInstructions ) {
		return '';
	}
	const instructions =
		userInstructions.length > GLOBAL_INSTRUCTIONS_MAX_LENGTH
			? `${ userInstructions.slice(
					0,
					GLOBAL_INSTRUCTIONS_MAX_LENGTH
			  ) }\n\n[The instructions file exceeds Studio's size limit and is truncated here; the user can shorten it in Studio settings.]`
			: userInstructions;
	return `

## The user's standing instructions

Saved in Studio's settings; they apply to every conversation.

${ instructions }`;
}
