/**
 * Agent Icon Component
 *
 * Renders an agent's icon using local SVG icons based on agent ID.
 * Returns null if no icon is available for the agent.
 */

import { memo } from 'react';
import { AGENT_ICONS } from 'src/modules/acp/config/agents';

interface AgentIconProps {
	agentId?: string;
	icon?: string;
	size?: number;
	className?: string;
}

/**
 * Check if a string is an inline SVG (starts with <svg).
 */
function isInlineSvg( str: string ): boolean {
	return str.trim().startsWith( '<svg' ) || str.trim().startsWith( '<?xml' );
}

/**
 * Get the local icon for an agent based on its ID.
 * Returns undefined if no icon is available.
 */
function getLocalIconForAgent( agentId?: string ): string | undefined {
	if ( ! agentId ) {
		return undefined;
	}

	// Map agent IDs to local icons (IDs must match registry exactly)
	const iconMap: Record< string, string > = {
		// Built-in agents
		wpcom: AGENT_ICONS.wpcom,
		'anthropic-builtin': AGENT_ICONS.anthropic,
		// Registry agents (from cdn.agentclientprotocol.com)
		'claude-code-acp': AGENT_ICONS.claudeCode,
		'codex-acp': AGENT_ICONS.codex,
		gemini: AGENT_ICONS.gemini,
		'github-copilot': AGENT_ICONS.copilot,
		opencode: AGENT_ICONS.opencode,
	};

	return iconMap[ agentId ];
}

export const AgentIcon = memo( function AgentIcon( {
	agentId,
	icon,
	size = 24,
	className = '',
}: AgentIconProps ) {
	// Get local icon based on agent ID
	const localIcon = getLocalIconForAgent( agentId );

	// Use local icon if available, otherwise use provided icon if it's inline SVG
	const iconSource = localIcon ?? ( icon && isInlineSvg( icon ) ? icon : undefined );

	// Don't render anything if no icon
	if ( ! iconSource ) {
		return null;
	}

	return (
		<span
			className={ `inline-flex items-center justify-center shrink-0 ${ className }` }
			style={ { width: size, height: size } }
			dangerouslySetInnerHTML={ { __html: iconSource } }
			aria-hidden="true"
		/>
	);
} );

export default AgentIcon;
