import os from 'os';
import path from 'path';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

/**
 * Path-allowlist gating for the unified pi runtime.
 *
 * Background: when Studio ran on the Claude Agent SDK, it leaned on the SDK's
 * `permissionMode: 'auto'` — an LLM-mediated classifier that inspected each
 * tool call and decided allow/deny/ask server-side. Trunk commit 05a20caf
 * removed Studio's ad-hoc allow-once / allow-always / deny prompts in favor
 * of that classifier.
 *
 * Pi-agent-core ships nothing equivalent (see
 * `node_modules/@mariozechner/pi-coding-agent/dist/core/tools/path-utils.js`
 * — its tools resolve `~` and relative paths but pass absolute paths through
 * untouched, so a freshly-wired pi agent has full host filesystem access).
 * To keep "writes / edits / shell stay within the user's site folder" as a
 * hard guarantee on the unified runtime, the pi runtime's `beforeToolCall`
 * uses the helpers in this module to refuse path-gated calls aimed outside a
 * small allowlist of trusted roots. There is no prompt — denials are silent
 * with `ACCESS_DENIED_MESSAGE` surfaced as the tool result reason.
 */

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
	allowFreeForm?: boolean;
}

// Tools whose path arguments must stay inside the trusted roots. Bash is
// intentionally excluded — its `command` arg isn't a structured path so a
// static allowlist would have to parse arbitrary shell, which gets the wrong
// answer for both false positives and false negatives. Trust the system
// prompt, the model, and the surrounding process boundary for shell.
const PATH_GATED_TOOLS = [ 'Write', 'Edit', 'NotebookEdit' ] as const;
const PATH_INPUT_KEYS = [ 'path', 'file_path', 'filePath' ] as const;

export const STUDIO_ROOT = path.resolve( STUDIO_SITES_ROOT );
export const TMP_ROOT = path.resolve( os.tmpdir() );
const TRUSTED_TEMP_ROOT_CANDIDATES = [ TMP_ROOT, '/tmp' ];
export const TRUSTED_TEMP_ROOTS = Array.from(
	new Set( TRUSTED_TEMP_ROOT_CANDIDATES.map( ( trustedRoot ) => path.resolve( trustedRoot ) ) )
);

const TRUSTED_ROOTS = [ STUDIO_ROOT, ...TRUSTED_TEMP_ROOTS ];
const TRUSTED_ROOT_PREFIXES = TRUSTED_ROOTS.map( ( trustedRoot ) =>
	trustedRoot.endsWith( path.sep ) ? trustedRoot : `${ trustedRoot }${ path.sep }`
);

export const ACCESS_DENIED_MESSAGE = 'Access denied outside trusted directories';

export function isPathGatedTool( toolName: string ): boolean {
	return ( PATH_GATED_TOOLS as readonly string[] ).includes( toolName );
}

export function resolveToolPath( rawPath: string ): string {
	const expandedPath = rawPath.startsWith( '~/' )
		? path.join( os.homedir(), rawPath.slice( 2 ) )
		: rawPath;

	return path.isAbsolute( expandedPath )
		? path.resolve( expandedPath )
		: path.resolve( STUDIO_ROOT, expandedPath );
}

export function isPathWithinTrustedRoot( filePath: string ): boolean {
	const normalizedPath = resolveToolPath( filePath );
	return TRUSTED_ROOTS.some(
		( trustedRoot, index ) =>
			normalizedPath === trustedRoot || normalizedPath.startsWith( TRUSTED_ROOT_PREFIXES[ index ] )
	);
}

function getToolInputPaths( input: Record< string, unknown > ): string[] {
	return PATH_INPUT_KEYS.map( ( key ) => input[ key ] )
		.filter( ( value ) => typeof value === 'string' )
		.map( ( value ) => value as string )
		.filter( ( value ) => value.trim().length > 0 );
}

/**
 * Returns the first path argument in `input` that lives outside the trusted
 * roots, or `undefined` if all paths (or no paths) are inside. The pi
 * runtime's `beforeToolCall` blocks the call when this returns a value.
 */
export function findFirstPathOutsideTrustedRoots(
	input: Record< string, unknown >
): string | undefined {
	for ( const toolPath of getToolInputPaths( input ) ) {
		if ( ! isPathWithinTrustedRoot( toolPath ) ) {
			return toolPath;
		}
	}

	return undefined;
}
