import { getToolDetail, getToolDisplayName } from '@studio/common/ai/tools';
import type { SessionUpdate, ToolCallContent, ToolKind } from '@agentclientprotocol/sdk';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

const TOOL_KINDS: Record< string, ToolKind > = {
	Read: 'read',
	Write: 'edit',
	Edit: 'edit',
	Bash: 'execute',
	Grep: 'search',
	Glob: 'search',
	Ls: 'search',
	wp_cli: 'execute',
	wpcom_request: 'fetch',
	site_delete: 'delete',
	preview_delete: 'delete',
	Skill: 'think',
};

function toolKind( name: string ): ToolKind {
	return TOOL_KINDS[ name ] ?? 'other';
}

function toolTitle( name: string, args: unknown ): string {
	const input = args && typeof args === 'object' ? ( args as Record< string, unknown > ) : {};
	const label = getToolDisplayName( name, input );
	const detail = getToolDetail( name, input );
	return detail ? `${ label }: ${ detail }` : label;
}

function toolLocations( args: unknown ): { path: string }[] | undefined {
	const filePath = ( args as { path?: unknown } | undefined )?.path;
	return typeof filePath === 'string' && filePath ? [ { path: filePath } ] : undefined;
}

function toolResultContent( result: unknown ): ToolCallContent[] {
	const blocks = ( result as { content?: ToolResultMessage[ 'content' ] } | undefined )?.content;
	if ( ! Array.isArray( blocks ) ) {
		return [];
	}
	return blocks.flatMap( ( block ): ToolCallContent[] => {
		if ( block.type === 'text' && block.text ) {
			return [ { type: 'content', content: { type: 'text', text: block.text } } ];
		}
		if ( block.type === 'image' ) {
			return [
				{
					type: 'content',
					content: { type: 'image', data: block.data, mimeType: block.mimeType },
				},
			];
		}
		return [];
	} );
}

/**
 * Translates one pi agent event into the ACP `session/update`s a client
 * renders. Text, reasoning, and tool calls stream live; everything else
 * (turn bookkeeping, retries, compaction) stays internal.
 */
export function toSessionUpdates( event: AgentSessionEvent ): SessionUpdate[] {
	switch ( event.type ) {
		case 'message_update': {
			const update = event.assistantMessageEvent;
			if ( update.type === 'text_delta' && update.delta ) {
				return [
					{
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: update.delta },
					},
				];
			}
			if ( update.type === 'thinking_delta' && update.delta ) {
				return [
					{
						sessionUpdate: 'agent_thought_chunk',
						content: { type: 'text', text: update.delta },
					},
				];
			}
			return [];
		}
		case 'tool_execution_start':
			return [
				{
					sessionUpdate: 'tool_call',
					toolCallId: event.toolCallId,
					title: toolTitle( event.toolName, event.args ),
					kind: toolKind( event.toolName ),
					status: 'in_progress',
					rawInput: event.args,
					locations: toolLocations( event.args ),
				},
			];
		case 'tool_execution_end':
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: event.toolCallId,
					status: event.isError ? 'failed' : 'completed',
					content: toolResultContent( event.result ),
				},
			];
		default:
			return [];
	}
}
