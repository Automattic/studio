import path from 'path';
import { boundedText } from './bounded-list';
import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from './global-instructions';
import { formatActiveSite } from './site-selection';
import { studioMessage } from './studio-message';
import type { RemoteHost } from './remote-hosts';
import type { SiteInfo } from './types';

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
	// The hosts besides this computer that the user's sites are on.
	remoteHosts?: Record< string, RemoteHost >;
	// Facts about the computer Bash commands run on, one line each.
	environmentFacts?: string[];
}

// What a turn starts from that can change between turns: the site the user has
// open, or their sites when none is, and where Bash starts. It reaches the
// model as a message when it changes rather than in the system prompt, so the
// system prompt stays the same for the whole conversation and the provider's
// prompt cache holds across turns: a prompt naming the sites changes near its
// top as soon as a turn creates one, and every later token is read uncached.
export interface TurnContextOptions {
	// The site this turn works on.
	activeSite?: SiteInfo | null;
	// Facts about the active site read from its own data, one line each (for
	// example the WordPress version it runs).
	activeSiteFacts?: string[];
	// The hosts besides this computer that the user's sites are on.
	remoteHosts?: Record< string, RemoteHost >;
	// The folder each Bash command starts in.
	shellDirectory?: string;
	// The user's local sites, stated when no site is active.
	localSites?: Array< { name: string; path: string } >;
}

// Enough to recognize a site by name; a longer list ends with how many more.
export const LISTED_SITES_MAX = 20;

// The user's local sites by name and folder: under the folder Bash starts in
// by its relative path, elsewhere by its absolute one.
function localSitesLine(
	sites: Array< { name: string; path: string } >,
	shellDirectory?: string
): string {
	if ( ! sites.length ) {
		return '\n- No site is open in Studio, and the user has no local sites yet.';
	}
	const folder = ( sitePath: string ) =>
		shellDirectory && sitePath.startsWith( shellDirectory + path.sep )
			? sitePath.slice( shellDirectory.length + 1 )
			: sitePath;
	return `\n- No site is open in Studio. The user's local sites: ${ boundedText(
		sites.map( ( site ) => `"${ site.name }" (${ folder( site.path ) })` ),
		LISTED_SITES_MAX
	) }.`;
}

// The WordPress.com AI proxy admits Studio requests only when the system prompt
// opens with this line, byte for byte; everything after it is Studio's.
export const PROXY_IDENTITY = 'You are WordPress Studio, built by Automattic.';

// Another agent drives Studio's tools over MCP; it has its own identity.
const EXTERNAL_IDENTITY = 'WordPress Studio, built by Automattic, is the app behind these tools.';

// What each host's sites are, one line each.
function hostEnvironment( remoteHosts: Record< string, RemoteHost > ): string {
	return Object.values( remoteHosts )
		.map( ( host ) => `\n- ${ host.environment }` )
		.join( '' );
}

const environment = (
	remoteHosts: Record< string, RemoteHost >,
	facts: string[] = []
) => `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk.${ hostEnvironment(
	remoteHosts
) }
- The active site is the one the user has open in Studio.${ facts
	.map( ( fact ) => `\n- ${ fact }` )
	.join( '' ) }`;

const externalEnvironment = ( remoteHosts: Record< string, RemoteHost > ) => `## Environment

- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder (site_info and site_create report it): WordPress core (\`wp-includes/\`, \`wp-admin/\`) and every installed theme and plugin (\`wp-content/\`) are on disk.${ hostEnvironment(
	remoteHosts
) }
- Studio's skills are runbooks for its workflows, served by \`studio_instructions\` with \`skill\` set to the skill's name. Where a runbook says Write or Edit, that is your own file tools.
- A runbook step that asks the user ends the turn; the answer arrives as the user's next message.`;

export function buildSystemPrompt( options: BuildSystemPromptOptions = {} ): string {
	const identity = options.external ? EXTERNAL_IDENTITY : PROXY_IDENTITY;
	const remoteHosts = options.remoteHosts ?? {};
	const environmentSection = options.external
		? externalEnvironment( remoteHosts )
		: environment( remoteHosts, options.environmentFacts );
	return `${ identity }

${ environmentSection }${ buildUserInstructionsSection( options.userInstructions ) }
`;
}

/** The turn's context as Studio states it to the model, tagged as Studio's. */
export function buildTurnContext( options: TurnContextOptions = {} ): string {
	const { activeSite, shellDirectory, localSites } = options;
	const lines = `${
		! activeSite && localSites ? localSitesLine( localSites, shellDirectory ) : ''
	}${
		shellDirectory ? `\n- Each Bash command starts in ${ shellDirectory }.` : ''
	}${ buildActiveSiteSection(
		activeSite,
		options.activeSiteFacts,
		options.remoteHosts ?? {}
	) }`.trim();
	return studioMessage( 'context', [ lines ] ) ?? '';
}

function buildActiveSiteSection(
	site: SiteInfo | null | undefined,
	facts: string[] = [],
	remoteHosts: Record< string, RemoteHost >
): string {
	if ( ! site ) {
		return '';
	}
	return `\n\n## Active site\n\n${ [ formatActiveSite( site, remoteHosts ), ...facts ].join(
		'\n'
	) }`;
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
