import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Tools whose success can change what the site renders. The Studio preview
// reloads once after each model turn in which one of them succeeded.
const PREVIEW_CHANGING_TOOLS = new Set( [
	'Write',
	'Edit',
	'wp_cli',
	'wpcom_request',
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

export function isReadOnlyWpCli( command: string ): boolean {
	const words = command.trim().split( /\s+/ );
	return words.length < 2 || words[ 0 ] === 'help' || READ_ONLY_WP_CLI_VERBS.has( words[ 1 ] );
}

function onlyReads( toolName: string, args: Record< string, unknown > | undefined ): boolean {
	if ( toolName === 'wp_cli' ) {
		return typeof args?.command !== 'string' || isReadOnlyWpCli( args.command );
	}
	if ( toolName === 'wpcom_request' ) {
		return args?.method === 'GET';
	}
	return false;
}

export function changesPreview( event: AgentSessionEvent ): boolean {
	if ( event.type !== 'turn_end' ) return false;
	const { message } = event;
	const content = message.role === 'assistant' ? message.content : [];
	return event.toolResults.some( ( result ) => {
		if ( result.isError || ! PREVIEW_CHANGING_TOOLS.has( result.toolName ) ) return false;
		const call = content.find(
			( part ) => part.type === 'toolCall' && part.id === result.toolCallId
		);
		const args = call?.type === 'toolCall' ? call.arguments : undefined;
		return ! onlyReads( result.toolName, args );
	} );
}
