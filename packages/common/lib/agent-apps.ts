/**
 * The agent apps that Settings connects to Studio. Browser-safe: the hosts
 * connect them with `connect-agent-app.ts`.
 */
export const AGENT_APP_IDS = [ 'claude-code', 'codex', 'cursor', 'grok-build' ] as const;

export type AgentAppId = ( typeof AGENT_APP_IDS )[ number ];

export interface AgentApp {
	id: AgentAppId;
	installed: boolean;
	// Has the Studio plugin.
	connected: boolean;
	updateStatus?: 'available' | 'failed' | 'updating';
}

// Product names, so not translated. Codex plugins install in the ChatGPT app,
// which people know it by.
export const AGENT_APP_NAMES: Record< AgentAppId, string > = {
	'claude-code': 'Claude Code',
	codex: 'ChatGPT',
	cursor: 'Cursor',
	'grok-build': 'Grok Build',
};

export function isAgentAppId( value: unknown ): value is AgentAppId {
	return ( AGENT_APP_IDS as readonly unknown[] ).includes( value );
}
