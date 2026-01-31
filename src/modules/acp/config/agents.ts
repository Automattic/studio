/**
 * Agent Configuration
 *
 * Defines all available agents including built-in and ACP-based agents.
 */

import type { AgentConfig } from '../types';

// ============================================================================
// Agent Icons (SVG strings)
// ============================================================================

export const AGENT_ICONS = {
	// WordPress - Simple Icons
	wpcom: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#3858E9"/>
		<g transform="translate(3, 3) scale(0.75)">
			<path d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0" fill="white"/>
		</g>
	</svg>`,

	// Anthropic - Simple Icons
	anthropic: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#191919"/>
		<g transform="translate(3, 4.5) scale(0.75)">
			<path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" fill="white"/>
		</g>
	</svg>`,

	// Claude Code - Same as Anthropic with terminal accent
	claudeCode: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#D4A574"/>
		<g transform="translate(3, 4.5) scale(0.75)">
			<path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" fill="white"/>
		</g>
	</svg>`,

	// OpenAI/Codex - Simple Icons
	codex: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#412991"/>
		<g transform="translate(3, 3) scale(0.75)">
			<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="white"/>
		</g>
	</svg>`,

	// Google Gemini - Simple Icons
	gemini: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#8E75B2"/>
		<g transform="translate(3, 3) scale(0.75)">
			<path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" fill="white"/>
		</g>
	</svg>`,

	// GitHub Copilot - Simple Icons (GitHub logo)
	copilot: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#181717"/>
		<g transform="translate(3, 3) scale(0.75)">
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="white"/>
		</g>
	</svg>`,

	// OpenCode - Custom logo
	opencode: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#3B3636"/>
		<g transform="translate(4.8, 2.4) scale(0.45)">
			<path d="M24 32H8V16H24V32Z" fill="#4B4646"/>
			<path d="M24 8H8V32H24V8ZM32 40H0V0H32V40Z" fill="#F1ECEC"/>
		</g>
	</svg>`,

	// Goose - Custom (Block's goose agent)
	goose: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#FF6B35"/>
		<path d="M12 5C8.5 5 6 8 6 11C6 14 7.5 16 9 17L9 19H15L15 17C16.5 16 18 14 18 11C18 8 15.5 5 12 5Z" fill="white"/>
		<circle cx="10" cy="10" r="1" fill="#FF6B35"/>
		<circle cx="14" cy="10" r="1" fill="#FF6B35"/>
		<path d="M10 13H14L12 15L10 13Z" fill="#FF6B35"/>
	</svg>`,

	// Generic fallback
	generic: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="#6B7280"/>
		<path d="M12 6L13.5 9H17L14.5 11L15.5 14L12 12L8.5 14L9.5 11L7 9H10.5L12 6Z" fill="white"/>
	</svg>`,
};

// ============================================================================
// Built-in Agents
// ============================================================================

export const BUILTIN_AGENTS: AgentConfig[] = [
	{
		id: 'wpcom',
		name: 'WordPress AI',
		description: 'AI-powered WordPress assistant with WordPress.com integration',
		provider: 'wpcom',
		icon: AGENT_ICONS.wpcom,
		isInstalled: true,
		status: 'available',
	},
	{
		id: 'anthropic-builtin',
		name: 'Built-in Assistant (Anthropic)',
		description: 'Local AI assistant powered by Claude with WP-CLI access',
		provider: 'anthropic-builtin',
		icon: AGENT_ICONS.anthropic,
		apiKeyEnvVar: 'ANTHROPIC_API_KEY',
		isInstalled: true,
		status: 'available',
	},
];

// ============================================================================
// ACP Agent Definitions
// ============================================================================

// ACP agents are now loaded dynamically from the official registry:
// https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
// See: src/modules/acp/lib/acp-registry.ts

// ============================================================================
// Default Agent
// ============================================================================

export const DEFAULT_AGENT_ID = 'wpcom';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all built-in agents (always available).
 */
export function getBuiltinAgents(): AgentConfig[] {
	return BUILTIN_AGENTS;
}

/**
 * Get a built-in agent config by ID.
 * For ACP agents, use detectAgentById from agent-detection.ts
 */
export function getBuiltinAgentById( id: string ): AgentConfig | undefined {
	return BUILTIN_AGENTS.find( ( agent ) => agent.id === id );
}

/**
 * Get the icon for an agent (with fallback to generic icon).
 * Prefers icons from the registry if available, falls back to local icons.
 */
export function getAgentIcon( agentId: string ): string {
	// Check built-in agents first
	const builtinAgent = getBuiltinAgentById( agentId );
	if ( builtinAgent?.icon ) {
		return builtinAgent.icon;
	}

	// Return generic fallback
	return AGENT_ICONS.generic;
}
