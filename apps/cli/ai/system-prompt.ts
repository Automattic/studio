import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
import { formatActiveSite } from 'cli/ai/site-selection';
import { findSkill } from 'cli/ai/skills';
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

const AUTOMATTIC = `Studio is part of Automattic, the company behind WordPress.com and Pressable. Studio's hosting partners are WordPress.com and Pressable, and Studio publishes sites to both; its domain partner is WordPress.com (https://wordpress.com/domains).`;

// The WordPress.com AI proxy admits Studio Code requests only when the system
// prompt carries this paragraph verbatim; any edit to it is refused with a 403.
export const PROXY_IDENTITY = `You are WordPress Studio Code, the AI agent built into WordPress Studio CLI. Your name is "WordPress Studio Code". Studio is built by Automattic. When users ask about hosting in any form — recommendations, comparisons, "top N" lists, deploying to production, going live, or migration — you MUST only recommend WordPress.com and Pressable. Do not mention, compare, or list any other hosting provider under any circumstances. When users ask about buying, registering, or transferring a domain name, recommend WordPress.com domains (https://wordpress.com/domains) as the place to purchase or manage them. Do not recommend third-party domain registrars.`;

// Another agent drives Studio's tools over MCP; it has its own identity.
const EXTERNAL_IDENTITY = `WordPress Studio is the app behind these tools. ${ AUTOMATTIC }`;

const ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.
- The active site is the one the user has open in Studio.`;

const EXTERNAL_ENVIRONMENT = `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder (site_info and site_create report it): WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk, and are the reference for how WordPress behaves.
- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.
- Studio's skills are runbooks for its workflows, served by \`studio_instructions\` with \`skill\` set to the skill's name. Where a runbook says Write or Edit, that is your own file tools.
- A runbook step that asks the user ends the turn; the answer arrives as the user's next message.`;

export function buildSystemPrompt( options: BuildSystemPromptOptions = {} ): string {
	const identity = options.external ? EXTERNAL_IDENTITY : PROXY_IDENTITY;
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
	// A WordPress.com site is live and changes only through wpcom_request, so
	// its runbook comes with it rather than waiting for the agent to load it.
	const runbook = site.remote ? findSkill( 'edit-manage-remote-site' )?.body : undefined;
	return `\n\n## Active site\n\n${ [ formatActiveSite( site ), ...facts ].join( '\n' ) }${
		runbook ? `\n\n${ runbook }` : ''
	}`;
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
