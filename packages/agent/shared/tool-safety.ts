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
async function findWordPressRoot(
	{ files, path }: StudioAgentHost,
	filePath: string
): Promise< string | undefined > {
	for (
		let dir = path.dirname( filePath );
		dir !== path.dirname( dir );
		dir = path.dirname( dir )
	) {
		if (
			( await files.exists( path.join( dir, 'wp-includes' ) ) ) &&
			( await files.exists( path.join( dir, 'wp-content' ) ) )
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
	const root = await findWordPressRoot( host, absolutePath );
	if ( ! root ) {
		return undefined;
	}
	const relativePath = host.path.relative( root, absolutePath ).split( host.path.sep ).join( '/' );
	const isCore =
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath );
	if ( ! isCore || ! ( await host.sites.findByFolder( root ) ) ) {
		return undefined;
	}
	return `Not run: ${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`;
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
		( await getFileWriteRefusal( toolName, params, host, resolvePath ) );
	if ( refusal ) {
		throw new Error( refusal );
	}
}
