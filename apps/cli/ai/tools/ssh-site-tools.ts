import path from 'path';
import { Type } from 'typebox';
import {
	buildRemoteShellCommand,
	describeSshFailure,
	ensureRelativeSitePath,
	execSsh,
	shellQuote,
	type SshConnection,
	type SshExecOptions,
} from 'cli/lib/ssh';
import { defineTool } from './define-tool';
import { textResult } from './utils';
import { getUnsupportedWpCliOptionMessage, splitCommandArgs } from './wp-cli';

/**
 * Agent tools for a third-party WordPress site managed over SSH. Each tool is
 * bound to one saved connection and executes on the remote server through the
 * system `ssh` binary. There is deliberately no general-purpose remote Bash
 * tool: the agent gets WP-CLI plus file operations jailed to the WordPress
 * root, nothing else.
 *
 * The file tools reuse the local tool names (Read/Write/Edit/Grep/Glob/Ls) so
 * the agent's habits — and Studio's per-tool payload guards, which are keyed
 * by tool name — carry over unchanged.
 */

const FILE_READ_MAX_BYTES = 100 * 1024;
const LISTING_MAX_LINES = 500;

interface RunRemoteOptions extends SshExecOptions {
	// When set, a non-zero exit code produces this error prefix + stderr.
	errorContext?: string;
}

async function runRemote(
	connection: SshConnection,
	command: string,
	options: RunRemoteOptions = {}
): Promise< string > {
	const { errorContext, ...execOptions } = options;
	const result = await execSsh(
		connection,
		buildRemoteShellCommand( connection, command ),
		execOptions
	);
	if ( result.exitCode !== 0 ) {
		const failure = describeSshFailure( result, connection );
		throw new Error( errorContext ? `${ errorContext }: ${ failure }` : failure );
	}
	return result.stdout;
}

// Remote commands `cd` into the WordPress root, so file paths stay relative.
function quotedSitePath( relativePath: string ): string {
	return shellQuote( ensureRelativeSitePath( relativePath ) );
}

const RELATIVE_PATH_DESCRIPTION =
	'File path relative to the WordPress root of the remote site, e.g. "wp-content/themes/mytheme/style.css".';

export function createSshReadTool( connection: SshConnection ) {
	return defineTool(
		'Read',
		`Reads a file from the remote WordPress site over SSH. Paths are relative to the WordPress root (${ connection.remotePath }). Files larger than ${ FILE_READ_MAX_BYTES } bytes are rejected — use Grep to locate the relevant part instead.`,
		{
			path: Type.String( { description: RELATIVE_PATH_DESCRIPTION } ),
		},
		async ( args ) => {
			const stdout = await runRemote( connection, `cat -- ${ quotedSitePath( args.path ) }`, {
				maxOutputBytes: FILE_READ_MAX_BYTES,
				errorContext: `Failed to read ${ args.path }`,
			} );
			return textResult( stdout );
		}
	);
}

async function writeRemoteFile(
	connection: SshConnection,
	relativePath: string,
	content: string
): Promise< void > {
	const sitePath = ensureRelativeSitePath( relativePath );
	const directory = path.posix.dirname( sitePath );
	await runRemote(
		connection,
		`mkdir -p -- ${ shellQuote( directory ) } && cat > ${ shellQuote( sitePath ) }`,
		{ stdin: content, errorContext: `Failed to write ${ relativePath }` }
	);
}

export function createSshWriteTool( connection: SshConnection ) {
	return defineTool(
		'Write',
		`Writes a file on the remote WordPress site over SSH, creating parent directories as needed and overwriting any existing file. Paths are relative to the WordPress root (${ connection.remotePath }).`,
		{
			path: Type.String( { description: RELATIVE_PATH_DESCRIPTION } ),
			content: Type.String( { description: 'The full content to write to the file.' } ),
		},
		async ( args ) => {
			await writeRemoteFile( connection, args.path, args.content );
			return textResult( `Wrote ${ args.path }` );
		}
	);
}

function countOccurrences( haystack: string, needle: string ): number {
	if ( ! needle ) {
		return 0;
	}
	return haystack.split( needle ).length - 1;
}

export function createSshEditTool( connection: SshConnection ) {
	return defineTool(
		'Edit',
		`Performs an exact string replacement in a file on the remote WordPress site over SSH. old_string must match the file content exactly (including whitespace) and must be unique in the file unless replace_all is true. Paths are relative to the WordPress root (${ connection.remotePath }).`,
		{
			path: Type.String( { description: RELATIVE_PATH_DESCRIPTION } ),
			old_string: Type.String( { description: 'The exact text to replace.' } ),
			new_string: Type.String( { description: 'The replacement text.' } ),
			replace_all: Type.Optional(
				Type.Boolean( {
					description: 'Replace every occurrence of old_string instead of exactly one.',
				} )
			),
		},
		async ( args ) => {
			if ( args.old_string === args.new_string ) {
				throw new Error( 'old_string and new_string must be different.' );
			}
			const content = await runRemote( connection, `cat -- ${ quotedSitePath( args.path ) }`, {
				maxOutputBytes: FILE_READ_MAX_BYTES,
				errorContext: `Failed to read ${ args.path }`,
			} );
			const occurrences = countOccurrences( content, args.old_string );
			if ( occurrences === 0 ) {
				throw new Error( `old_string was not found in ${ args.path }.` );
			}
			if ( occurrences > 1 && ! args.replace_all ) {
				throw new Error(
					`old_string occurs ${ occurrences } times in ${ args.path }. Provide a longer, unique old_string or set replace_all to true.`
				);
			}
			const updated = args.replace_all
				? content.split( args.old_string ).join( args.new_string )
				: content.replace( args.old_string, args.new_string );
			await writeRemoteFile( connection, args.path, updated );
			return textResult(
				`Replaced ${ args.replace_all ? occurrences : 1 } occurrence(s) in ${ args.path }`
			);
		}
	);
}

// Listing/search commands are piped through `head` on the remote, so the exit
// code is head's; success/no-match are distinguished by output, and remote
// errors by stderr.
async function runRemoteListing(
	connection: SshConnection,
	command: string,
	noMatchMessage: string
): Promise< string > {
	const result = await execSsh(
		connection,
		buildRemoteShellCommand( connection, `${ command } | head -n ${ LISTING_MAX_LINES }` ),
		{ maxOutputBytes: FILE_READ_MAX_BYTES }
	);
	if ( result.exitCode !== 0 ) {
		throw new Error( describeSshFailure( result, connection ) );
	}
	const stdout = result.stdout.trim();
	if ( ! stdout ) {
		const stderr = result.stderr.trim();
		if ( stderr ) {
			throw new Error( stderr );
		}
		return noMatchMessage;
	}
	return stdout;
}

export function createSshGrepTool( connection: SshConnection ) {
	return defineTool(
		'Grep',
		`Searches file contents on the remote WordPress site over SSH using extended regular expressions (grep -E). Returns matching lines with file names and line numbers, capped at ${ LISTING_MAX_LINES } lines. Paths are relative to the WordPress root (${ connection.remotePath }).`,
		{
			pattern: Type.String( { description: 'Extended regular expression to search for.' } ),
			path: Type.Optional(
				Type.String( {
					description:
						'Directory or file to search, relative to the WordPress root. Defaults to the whole site.',
				} )
			),
			include: Type.Optional(
				Type.String( {
					description: 'Only search files matching this glob, e.g. "*.php" or "*.css".',
				} )
			),
		},
		async ( args ) => {
			const searchPath = quotedSitePath( args.path ?? '.' );
			const include = args.include ? ` --include=${ shellQuote( args.include ) }` : '';
			const command = `grep -rn -I -E${ include } -e ${ shellQuote(
				args.pattern
			) } -- ${ searchPath }`;
			const output = await runRemoteListing( connection, command, 'No matches found.' );
			return textResult( output );
		}
	);
}

export function createSshGlobTool( connection: SshConnection ) {
	return defineTool(
		'Glob',
		`Finds files by name pattern on the remote WordPress site over SSH, capped at ${ LISTING_MAX_LINES } results. Use a bare pattern like "*.php" to match file names anywhere under the search path, or a slash-separated pattern like "wp-content/themes/*/functions.php" to match whole paths.`,
		{
			pattern: Type.String( {
				description:
					'File name glob (e.g. "*.css") or path glob (e.g. "wp-content/plugins/*/readme.txt").',
			} ),
			path: Type.Optional(
				Type.String( {
					description:
						'Directory to search, relative to the WordPress root. Defaults to the whole site.',
				} )
			),
		},
		async ( args ) => {
			const base = ensureRelativeSitePath( args.path ?? '.' );
			// `find -path` matches the full emitted path (which starts with the
			// search base), so anchor path-style patterns there; `**` has no
			// meaning to find — a plain `*` already crosses directory boundaries
			// in -path matching.
			const matcher = args.pattern.includes( '/' )
				? `-path ${ shellQuote( `${ base }/${ args.pattern.replace( /\*\*/g, '*' ) }` ) }`
				: `-name ${ shellQuote( args.pattern ) }`;
			const command = `find ${ shellQuote( base ) } -type f ${ matcher }`;
			const output = await runRemoteListing( connection, command, 'No files found.' );
			return textResult( output );
		}
	);
}

export function createSshLsTool( connection: SshConnection ) {
	return defineTool(
		'Ls',
		`Lists a directory on the remote WordPress site over SSH (ls -la, capped at ${ LISTING_MAX_LINES } entries). Paths are relative to the WordPress root (${ connection.remotePath }).`,
		{
			path: Type.Optional(
				Type.String( {
					description: 'Directory to list, relative to the WordPress root. Defaults to the root.',
				} )
			),
		},
		async ( args ) => {
			const command = `ls -la -- ${ quotedSitePath( args.path ?? '.' ) }`;
			const output = await runRemoteListing( connection, command, 'Empty directory.' );
			return textResult( output );
		}
	);
}

export function createSshWpCliTool( connection: SshConnection ) {
	return defineTool(
		'wp_cli',
		`Runs a WP-CLI command on the remote WordPress site over SSH (in ${ connection.remotePath }). ` +
			'Examples: "plugin list --status=active", "option get blogname", "post list --post_type=page". ' +
			'Arguments are passed literally — shell substitution, pipes, and redirection are not available.',
		{
			command: Type.String( {
				description:
					'The WP-CLI command to run (without the "wp" prefix). Example: "plugin list --status=active"',
			} ),
		},
		async ( args ) => {
			const wpCliArgs = splitCommandArgs( args.command );
			const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( wpCliArgs );
			if ( unsupportedOptionMessage ) {
				throw new Error( unsupportedOptionMessage );
			}

			const wp = shellQuote( connection.wpCliPath ?? 'wp' );
			const remoteCommand = [ wp, ...wpCliArgs.map( shellQuote ) ].join( ' ' );
			const result = await execSsh(
				connection,
				buildRemoteShellCommand( connection, remoteCommand ),
				{}
			);

			let output = '';
			if ( result.stdout ) {
				output += result.stdout;
			}
			if ( result.stderr ) {
				output += ( output ? '\n' : '' ) + `stderr: ${ result.stderr }`;
			}
			if ( result.exitCode !== 0 ) {
				throw new Error(
					`Failed to run WP-CLI command: ${ output ? `${ output }\n` : '' }${ describeSshFailure(
						result,
						connection
					) }`
				);
			}
			return textResult( output || 'Command completed with no output.' );
		}
	);
}

export function createSshSiteTools( connection: SshConnection ) {
	return [
		createSshWpCliTool( connection ),
		createSshReadTool( connection ),
		createSshWriteTool( connection ),
		createSshEditTool( connection ),
		createSshGrepTool( connection ),
		createSshGlobTool( connection ),
		createSshLsTool( connection ),
	];
}
