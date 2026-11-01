import os from 'os';
import path from 'path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface StudioToolPayloadGuardState {
	incompleteToolCallReasons?: Record< string, string >;
}

function getStringParam( params: unknown, key: string ): string | undefined {
	if ( ! params || typeof params !== 'object' ) {
		return undefined;
	}
	const value = ( params as Record< string, unknown > )[ key ];
	return typeof value === 'string' ? value : undefined;
}

export function resolveToolPath( filePath: string, cwd: string ): string {
	const withoutAt = filePath.replace( /^@/, '' );
	const expanded =
		withoutAt === '~' || withoutAt.startsWith( '~/' )
			? path.join( os.homedir(), withoutAt.slice( 1 ) )
			: withoutAt;
	return path.resolve( cwd, expanded );
}

/** The file a Write or Edit call writes, as an absolute path. */
export function getWrittenFile(
	toolName: string,
	params: unknown,
	cwd: string
): string | undefined {
	const filePath = getStringParam( params, 'path' );
	return ( toolName === 'Write' || toolName === 'Edit' ) && filePath
		? resolveToolPath( filePath, cwd )
		: undefined;
}

/** The text a Write or Edit call puts in its file: a Write's content, an Edit's new texts. */
export function getWrittenText( toolName: string, params: unknown ): string {
	if ( toolName === 'Write' ) {
		return getStringParam( params, 'content' ) ?? '';
	}
	const edits = toolName === 'Edit' && ( params as { edits?: unknown } | undefined )?.edits;
	return Array.isArray( edits )
		? edits.map( ( edit ) => getStringParam( edit, 'newText' ) ?? '' ).join( '\n' )
		: '';
}

// Only the last content block can be mid-generation when the model hits the
// output cap — anything earlier was completed before the model moved on.
function getInProgressToolCall( content: unknown ): { id: string; name: string } | undefined {
	if ( ! Array.isArray( content ) || content.length === 0 ) {
		return undefined;
	}
	const last = content[ content.length - 1 ];
	if ( ! last || typeof last !== 'object' ) {
		return undefined;
	}
	const item = last as Record< string, unknown >;
	if ( item.type !== 'toolCall' ) {
		return undefined;
	}
	if ( typeof item.id !== 'string' || typeof item.name !== 'string' ) {
		return undefined;
	}
	return { id: item.id, name: item.name };
}

function createIncompleteToolCallMessage( toolName: string ): string {
	return (
		`Refusing to run ${ toolName } because the assistant response hit the model output ` +
		'limit while generating tool arguments; the arguments may be incomplete. Send the ' +
		'content in parts: a first Write with the start of the file, then Edit calls that add the rest.'
	);
}

export function updateStudioToolPayloadGuardState(
	event: AgentSessionEvent,
	state: StudioToolPayloadGuardState
): void {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return;
	}

	const inProgress = getInProgressToolCall( event.message.content );

	if ( event.message.stopReason === 'length' && inProgress ) {
		state.incompleteToolCallReasons = {
			[ inProgress.id ]: createIncompleteToolCallMessage( inProgress.name ),
		};
		return;
	}

	state.incompleteToolCallReasons = undefined;
}

export function getIncompleteToolCallReason(
	state: StudioToolPayloadGuardState,
	toolCallId: string
): string | undefined {
	return state.incompleteToolCallReasons?.[ toolCallId ];
}
