import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { HOSTS } from 'cli/ai/hosts';
import { formatActiveSite } from 'cli/ai/site-selection';
import type { SiteInfo } from 'cli/ai/types';

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
	// The site this turn works on. The prompt is rebuilt every turn, so this
	// always reflects the current site, also after compaction.
	activeSite?: SiteInfo | null;
	// Facts about the active site read from its own data, one line each (for
	// example the WordPress version it runs).
	activeSiteFacts?: string[];
}

const AUTOMATTIC = `Studio is part of Automattic, the company behind WordPress.com and Pressable.`;

// The WordPress.com AI proxy admits Studio requests only when the system prompt
// opens with this line, byte for byte; everything after it is Studio's.
export const PROXY_IDENTITY = 'You are WordPress Studio, built by Automattic.';

// Another agent drives Studio's tools over MCP; it has its own identity.
const EXTERNAL_IDENTITY = `WordPress Studio is the app behind these tools. ${ AUTOMATTIC }`;

// What each host's sites are, one line each.
const HOST_ENVIRONMENT = Object.values( HOSTS )
	.map( ( host ) => `- ${ host.environment }` )
	.join( '\n' );

const ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
${ HOST_ENVIRONMENT }
- The active site is the one the user has open in Studio.`;

const EXTERNAL_ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder (site_info and site_create report it): WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
${ HOST_ENVIRONMENT }
- Studio's skills are runbooks for its workflows, served by \`studio_instructions\` with \`skill\` set to the skill's name. Where a runbook says Write or Edit, that is your own file tools.
- A runbook step that asks the user ends the turn; the answer arrives as the user's next message.`;

export function buildSystemPrompt( options: BuildSystemPromptOptions = {} ): string {
	const identity = options.external ? EXTERNAL_IDENTITY : `${ PROXY_IDENTITY } ${ AUTOMATTIC }`;
	const environment = options.external ? EXTERNAL_ENVIRONMENT : ENVIRONMENT;
	return `${ identity }

${ environment }${ buildActiveSiteSection(
		options.activeSite,
		options.activeSiteFacts
	) }${ buildUserInstructionsSection( options.userInstructions ) }
`;
}

function buildActiveSiteSection( site?: SiteInfo | null, facts: string[] = [] ): string {
	if ( ! site ) {
		return '';
	}
	return `\n\n## Active site\n\n${ [ formatActiveSite( site ), ...facts ].join( '\n' ) }`;
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
