import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Tools whose success can change what the site renders. The Studio preview
// reloads once after each model turn in which one of them succeeded.
const PREVIEW_CHANGING_TOOLS = new Set( [
	'Write',
	'Edit',
	'wp_cli',
	'scaffold_theme',
	'site_import',
	'site_pull',
] );

// WP-CLI verbs that only read, in `<command> <verb>` position (`post list`).
const READ_ONLY_WP_CLI_VERBS = new Set( [
	'list',
	'get',
	'status',
	'search',
	'exists',
	'path',
	'count',
	'version',
	'is-installed',
	'is-active',
	'pluck',
	'info',
	'check-update',
	'verify-checksums',
] );

function isReadOnlyWpCli( command: string ): boolean {
	const words = command.trim().split( /\s+/ );
	return words.length < 2 || words[ 0 ] === 'help' || READ_ONLY_WP_CLI_VERBS.has( words[ 1 ] );
}

export function changesPreview( event: AgentSessionEvent ): boolean {
	if ( event.type !== 'turn_end' ) return false;
	const { message } = event;
	const content = message.role === 'assistant' ? message.content : [];
	return event.toolResults.some( ( result ) => {
		if ( result.isError || ! PREVIEW_CHANGING_TOOLS.has( result.toolName ) ) return false;
		if ( result.toolName !== 'wp_cli' ) return true;
		const call = content.find(
			( part ) => part.type === 'toolCall' && part.id === result.toolCallId
		);
		const command = call?.type === 'toolCall' ? call.arguments?.command : undefined;
		return typeof command === 'string' && ! isReadOnlyWpCli( command );
	} );
}
