import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Tools whose success can change what the site renders, a shell command
// (which runs WP-CLI) among them. The Studio preview reloads once after each
// model turn in which one of them succeeded.
const PREVIEW_CHANGING_TOOLS = new Set( [ 'Write', 'Edit', 'Bash', 'site_import', 'site_pull' ] );

export function changesPreview( event: AgentSessionEvent ): boolean {
	if ( event.type !== 'turn_end' ) return false;
	return event.toolResults.some(
		( result ) => ! result.isError && PREVIEW_CHANGING_TOOLS.has( result.toolName )
	);
}
