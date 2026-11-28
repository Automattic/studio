import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { StudioAgentHost } from './host';

// Keep individual model-generated tool payloads below the range where long
// strings have been observed to arrive incomplete.
export const STUDIO_FILE_TOOL_MAX_BYTES = 14 * 1024;
const STUDIO_BASH_COMMAND_MAX_BYTES = 8 * 1024;

const encoder = new TextEncoder();

function getByteLength( value: string ): number {
	return encoder.encode( value ).length;
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
		// The edit tool takes `{ path, edits: [ { oldText, newText } ] }`; the
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

/** The WordPress install a file is in, if any: the nearest folder with wp-includes/ and wp-content/. */
async function findWordPressRoot( filePath: string ): Promise< string | undefined > {
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
 * `resolvePath` resolves the tool's `path` the way the runtime's file tools do.
 */
export async function getFileWriteRefusal(
	toolName: string,
	params: unknown,
	host: StudioAgentHost,
	resolvePath: ( file: string ) => string
): Promise< string | undefined > {
	const filePath = getStringParam( params, 'path' );
	if ( ( toolName !== 'Write' && toolName !== 'Edit' ) || ! filePath ) {
		return undefined;
	}
	const absolutePath = resolvePath( filePath );
	const root = await findWordPressRoot( absolutePath );
	if ( ! root ) {
		return undefined;
	}
	const relativePath = path.relative( root, absolutePath ).split( path.sep ).join( '/' );
	const isCore =
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath );
	if ( ! isCore || ! ( await host.sites.findByFolder( root ) ) ) {
		return undefined;
	}
	return `Not run: ${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`;
}

// The folders of Studio's settings directory the agent works in: payload files,
// the user's skills and their global instructions. The rest holds sign-ins and API keys.
const AGENT_SETTINGS_FOLDERS = new Set( [ 'tmp', 'skills', 'knowledge' ] );

const SETTINGS_REFUSAL =
	"Studio's settings folder holds the user's sign-ins and API keys, so Studio Code doesn't read or change it. Use Studio's tools for sites, previews and WordPress.com instead.";

// macOS and Windows file systems ignore case by default.
function foldCase( value: string ): string {
	return process.platform === 'linux' ? value : value.toLowerCase();
}

function isWithin( parent: string, child: string ): boolean {
	const relative = path.relative( foldCase( parent ), foldCase( child ) );
	return ! relative.startsWith( '..' ) && ! path.isAbsolute( relative );
}

// Where a path really points, through symlinks and Windows short names. A file
// not written yet resolves through the nearest folder that exists.
function realPath( file: string ): string {
	try {
		return realpathSync.native( file );
	} catch {
		const parent = path.dirname( file );
		return parent === file ? file : path.join( realPath( parent ), path.basename( file ) );
	}
}

function isSettingsPath( segments: string[] ): boolean {
	return (
		! AGENT_SETTINGS_FOLDERS.has( foldCase( segments[ 0 ] ?? '' ) ) || segments.includes( '..' )
	);
}

// `.studio` as a path segment: `~/.studio`, `$HOME/.studio/config.json`, `.studio/shared.json`.
const SETTINGS_IN_COMMAND = /(?:^|[\s'"`=:/\\])\.studio(?![\w.-])([^\s'"`;|&()<>]*)/gi;

/**
 * Keeps the agent's file tools out of Studio's settings folder, where the
 * WordPress.com token and provider API keys are stored. The Bash check only
 * catches commands that name the folder: a guardrail, not a sandbox.
 */
export function getSettingsAccessRefusal(
	toolName: string,
	params: unknown,
	resolvePath: ( file: string ) => string
): string | undefined {
	if ( toolName === 'Bash' ) {
		const command = getStringParam( params, 'command' ) ?? '';
		for ( const [ , rest ] of command.matchAll( SETTINGS_IN_COMMAND ) ) {
			if ( isSettingsPath( rest.split( /[\\/]+/ ).filter( Boolean ) ) ) {
				return `Not run: ${ SETTINGS_REFUSAL }`;
			}
		}
		return undefined;
	}
	if ( ! [ 'Read', 'Write', 'Edit', 'Grep' ].includes( toolName ) ) {
		return undefined;
	}
	const filePath = getStringParam( params, 'path' );
	if ( ! filePath ) {
		return undefined;
	}
	const absolutePath = realPath( resolvePath( filePath ) );
	const settings = realPath( getConfigDirectory() );
	if ( isWithin( settings, absolutePath ) ) {
		const relative = path.relative( foldCase( settings ), foldCase( absolutePath ) );
		return isSettingsPath( relative.split( path.sep ).filter( Boolean ) )
			? `Not run: ${ SETTINGS_REFUSAL }`
			: undefined;
	}
	// Grep searches hidden folders, so searching the home folder would read the settings too.
	if ( toolName === 'Grep' && isWithin( absolutePath, settings ) ) {
		return `Not run: searching ${ filePath } would read Studio's settings folder. ${ SETTINGS_REFUSAL } Search a site's folder instead.`;
	}
	return undefined;
}

// Every runtime runs this before a tool call: a refused call fails without
// running. Calls cut off at the model's output limit never get here; pi's loop
// fails them itself.
export async function assertToolCallAllowed(
	toolName: string,
	params: unknown,
	host: StudioAgentHost,
	resolvePath: ( file: string ) => string
): Promise< void > {
	const refusal =
		getPayloadLimitViolation( toolName, params ) ??
		getSettingsAccessRefusal( toolName, params, resolvePath ) ??
		( await getFileWriteRefusal( toolName, params, host, resolvePath ) );
	if ( refusal ) {
		throw new Error( refusal );
	}
}
