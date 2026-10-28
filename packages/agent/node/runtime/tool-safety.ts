import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Keep individual model-generated tool payloads below the range where long
// strings have been observed to arrive incomplete.
export const STUDIO_FILE_TOOL_MAX_BYTES = 14 * 1024;
const STUDIO_BASH_COMMAND_MAX_BYTES = 8 * 1024;

export interface StudioToolPayloadGuardState {
	incompleteToolCallReasons?: Record< string, string >;
}

function getByteLength( value: string ): number {
	return Buffer.byteLength( value, 'utf8' );
}

function formatBytes( bytes: number ): string {
	return `${ bytes } bytes`;
}

function getStringParam( params: unknown, key: string ): string | undefined {
	if ( ! params || typeof params !== 'object' ) {
		return undefined;
	}
	const value = ( params as Record< string, unknown > )[ key ];
	return typeof value === 'string' ? value : undefined;
}

function getEditEntries( params: unknown ): Array< { oldText: string; newText: string } > {
	if ( ! params || typeof params !== 'object' ) {
		return [];
	}
	let edits = ( params as Record< string, unknown > ).edits;
	// Some models send the array as a JSON string; pi parses it the same way.
	if ( typeof edits === 'string' ) {
		try {
			edits = JSON.parse( edits );
		} catch {
			return [];
		}
	}
	if ( ! Array.isArray( edits ) ) {
		return [];
	}
	return edits.map( ( edit ) => ( {
		oldText: getStringParam( edit, 'oldText' ) ?? '',
		newText: getStringParam( edit, 'newText' ) ?? '',
	} ) );
}

function getPayloadRecoveryAdvice( toolName: string ): string {
	if ( toolName === 'Bash' ) {
		return 'Split the work into smaller Write/Edit calls. Do not retry with Bash heredocs or Python scripts; they carry the same large payload risk.';
	}
	return 'Write a small skeleton and fill it with Edit calls that stay under the limit, several edits[] entries per call. Do not split the content across multiple files to concatenate later; that hits the same limit on the concatenation step.';
}

function createPayloadLimitMessage(
	toolName: string,
	fieldName: string,
	actualBytes: number,
	maxBytes: number
): string {
	return `${ toolName } ${ fieldName } is ${ formatBytes(
		actualBytes
	) }, exceeding Studio's ${ formatBytes(
		maxBytes
	) } single-call safety limit. ${ getPayloadRecoveryAdvice( toolName ) }`;
}

export function getPayloadLimitViolation( toolName: string, params: unknown ): string | undefined {
	if ( toolName === 'Write' ) {
		const content = getStringParam( params, 'content' );
		const bytes = content ? getByteLength( content ) : 0;
		if ( bytes > STUDIO_FILE_TOOL_MAX_BYTES ) {
			return createPayloadLimitMessage( toolName, 'content', bytes, STUDIO_FILE_TOOL_MAX_BYTES );
		}
	}

	if ( toolName === 'Edit' ) {
		// pi's edit tool takes `{ path, edits: [ { oldText, newText } ] }`; the
		// limit applies to the whole call, so sum every entry.
		const edits = getEditEntries( params );
		const bytes = edits.reduce(
			( total, edit ) => total + getByteLength( edit.oldText ) + getByteLength( edit.newText ),
			0
		);
		if ( bytes > STUDIO_FILE_TOOL_MAX_BYTES ) {
			return createPayloadLimitMessage( toolName, 'edits', bytes, STUDIO_FILE_TOOL_MAX_BYTES );
		}
	}

	if ( toolName === 'Bash' ) {
		const command = getStringParam( params, 'command' );
		const bytes = command ? getByteLength( command ) : 0;
		if ( bytes > STUDIO_BASH_COMMAND_MAX_BYTES ) {
			return createPayloadLimitMessage( toolName, 'command', bytes, STUDIO_BASH_COMMAND_MAX_BYTES );
		}
	}

	return undefined;
}

const CORE_ROOT_FILE = /^(index|xmlrpc|wp-(?!config\b)[a-z-]+)\.php$/;

function resolveToolPath( filePath: string, cwd: string ): string {
	const withoutAt = filePath.replace( /^@/, '' );
	const expanded =
		withoutAt === '~' || withoutAt.startsWith( '~/' )
			? path.join( os.homedir(), withoutAt.slice( 1 ) )
			: withoutAt;
	return path.resolve( cwd, expanded );
}

/** The WordPress install a file is in, if any: the nearest folder with wp-includes/ and wp-content/. */
function findWordPressRoot( filePath: string ): string | undefined {
	for (
		let dir = path.dirname( filePath );
		dir !== path.dirname( dir );
		dir = path.dirname( dir )
	) {
		if (
			existsSync( path.join( dir, 'wp-includes' ) ) &&
			existsSync( path.join( dir, 'wp-content' ) )
		) {
			return dir;
		}
	}
	return undefined;
}

/**
 * A Studio site's WordPress core is replaced when Studio updates WordPress, so
 * a change there is lost. Refuses Write and Edit on it and names where the
 * change belongs. WordPress trees that Studio doesn't manage stay writable.
 */
export async function getFileWriteRefusal(
	toolName: string,
	params: unknown,
	cwd: string,
	isStudioSite: ( folder: string ) => Promise< boolean >
): Promise< string | undefined > {
	const filePath = getStringParam( params, 'path' );
	if ( ( toolName !== 'Write' && toolName !== 'Edit' ) || ! filePath ) {
		return undefined;
	}
	const absolutePath = resolveToolPath( filePath, cwd );
	const root = findWordPressRoot( absolutePath );
	if ( ! root ) {
		return undefined;
	}
	const relativePath = path.relative( root, absolutePath ).split( path.sep ).join( '/' );
	const isCore =
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath );
	if ( ! isCore || ! ( await isStudioSite( root ) ) ) {
		return undefined;
	}
	return `Not run: ${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`;
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
		`limit while generating tool arguments; the arguments may be incomplete. ${ getPayloadRecoveryAdvice(
			toolName
		) }`
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
