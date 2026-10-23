import { Type } from 'typebox';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import {
	getUnsupportedWpCliPostContentMessage,
	routePostContentFile,
} from 'cli/lib/wp-cli-post-content';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { resolveSite } from './utils';

// Split a shell-ish command into args, respecting quotes. Quotes are only
// recognized at arg start or right after `=` so values like `Ember & Oak`
// in `--post_title="Ember & Oak"` come through whole.
function splitBasicCommandArgs( command: string ): string[] {
	const args: string[] = [];
	let current = '';
	let inQuote: string | null = null;

	for ( let i = 0; i < command.length; i++ ) {
		const char = command[ i ];

		if ( inQuote ) {
			if ( char === inQuote ) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (
			( char === '"' || char === "'" ) &&
			( current === '' || current.endsWith( '=' ) )
		) {
			inQuote = char;
		} else if ( /\s/.test( char ) ) {
			if ( current ) {
				args.push( current );
				current = '';
			}
		} else {
			current += char;
		}
	}

	if ( current ) {
		args.push( current );
	}

	return args;
}

function stripMatchingOuterQuotes( value: string ): string {
	if ( value.length < 2 ) {
		return value;
	}

	const firstChar = value[ 0 ];
	const lastChar = value[ value.length - 1 ];
	if ( ( firstChar === '"' || firstChar === "'" ) && firstChar === lastChar ) {
		return value.slice( 1, -1 );
	}

	return value;
}

// The value of a quoted argument starting at `text[ 0 ]`, read as a shell
// would: single quotes are literal, and inside double quotes a backslash
// escapes `"`, `\\`, `$` and backticks. `end` is the closing quote's index.
function readQuoted( text: string ): { value: string; end: number } | null {
	const quote = text[ 0 ];
	let value = '';
	for ( let i = 1; i < text.length; i++ ) {
		const char = text[ i ];
		if ( char === quote ) {
			return { value, end: i };
		}
		if ( quote === '"' && char === '\\' && /["\\$`]/.test( text[ i + 1 ] ?? '' ) ) {
			value += text[ ++i ];
		} else {
			value += char;
		}
	}
	return null;
}

// Quoted post_content needs trailing flags split out (e.g. `--porcelain`
// after the closing quote); unquoted block markup is treated as a single
// literal arg through end-of-command. A quote can also wrap the whole
// argument (`'--post_content=...'`).
function splitPostContentCommandArgs( command: string, postContentIndex: number ): string[] {
	const postContentMarker = '--post_content=';
	let prefix = command.slice( 0, postContentIndex ).trimEnd();
	let postContentTail = command.slice( postContentIndex + postContentMarker.length ).trim();
	const wrappingQuote = prefix.slice( -1 );
	if (
		( wrappingQuote === '"' || wrappingQuote === "'" ) &&
		/(^|\s)$/.test( prefix.slice( 0, -1 ) )
	) {
		prefix = prefix.slice( 0, -1 );
		postContentTail = wrappingQuote + postContentTail;
	}
	const prefixArgs = splitBasicCommandArgs( prefix.trim() );

	if ( ! postContentTail ) {
		return [ ...prefixArgs, postContentMarker ];
	}

	const quote = postContentTail[ 0 ];
	if ( quote === '"' || quote === "'" ) {
		const quoted = readQuoted( postContentTail );
		if ( quoted ) {
			const suffix = postContentTail.slice( quoted.end + 1 ).trim();
			return [
				...prefixArgs,
				`${ postContentMarker }${ quoted.value }`,
				...splitBasicCommandArgs( suffix ),
			];
		}
	}

	// No closing quote — large block content is commonly emitted without shell
	// quoting; treat everything after the marker as a single literal argument.
	return [
		...prefixArgs,
		`${ postContentMarker }${ stripMatchingOuterQuotes( postContentTail ) }`,
	];
}

function splitCommandArgs( command: string ): string[] {
	const postContentMarker = '--post_content=';
	const postContentIndex = command.indexOf( postContentMarker );

	if ( postContentIndex !== -1 ) {
		return splitPostContentCommandArgs( command, postContentIndex );
	}

	return splitBasicCommandArgs( command );
}

// LLMs sometimes emit en/em dashes (`‐porcelain`, `–color`); WP-CLI silently
// ignores them, so reject up-front and let the agent retry with ASCII hyphens.
function getUnsupportedWpCliOptionMessage( args: string[] ): string | null {
	const unsupportedOption = args.find( ( arg ) => /^[‐-―]\S+/.test( arg ) );
	if ( ! unsupportedOption ) {
		return null;
	}
	return `Unsupported WP-CLI option "${ unsupportedOption }": use ASCII hyphens, for example "--porcelain", not a typographic dash.`;
}

export const runWpCliTool = defineTool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running (site_start if needed). ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list". ' +
		'The command takes literal arguments, not shell syntax — never use shell substitution or shell syntax such as `$(cat file)`, backticks, pipes, redirection, or environment variables to provide post content. ' +
		'For large post content, write the validated markup to a scratch file inside the site directory and pass its path to `post create <file>` (or `post update <id> <file>`) — this avoids the OS command-length limit. For smaller content you may instead pass it inline with `--post_content=...` as the final argument. ' +
		'Studio sites use SQLite, not MySQL (the database file is `<site-path>/wp-content/database/.ht.sqlite`): `db query` and the other `db` subcommands do not work, so query WordPress data with object commands such as `post list`, `option get`, or `user list`. ' +
		'Users can browse the database themselves with phpMyAdmin from the site overview in the Studio app while the site is running, or with `sqlite3 <site-path>/wp-content/database/.ht.sqlite` (pre-installed on macOS).',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		command: Type.String( {
			description:
				'The WP-CLI command to run (without the "wp" prefix). Example: "plugin list --status=active"',
		} ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connectToDaemon();

				const splitArgs = splitCommandArgs( args.command );
				const routed = routePostContentFile( splitArgs, site.path );
				const wpCliArgs = routed?.args ?? splitArgs;
				const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( wpCliArgs );
				if ( unsupportedOptionMessage ) {
					throw new Error( unsupportedOptionMessage );
				}
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					throw new Error( unsupportedPostContentMessage );
				}

				await using command = await runWpCliCommand( site, wpCliArgs );
				const exitCode = await command.response.exitCode;
				const stdout = await command.response.stdoutText;
				const stderr = await command.response.stderrText;

				let output = routed
					? `Read the post content from ${ routed.file }, the file \`--post_content\` named.\n`
					: '';
				if ( stdout ) {
					output += stdout;
				}
				if ( stderr ) {
					output += ( output ? '\n' : '' ) + `stderr: ${ stderr }`;
				}
				if ( exitCode !== 0 ) {
					output += `\nExit code: ${ exitCode }`;
				}

				if ( exitCode !== 0 ) {
					throw new Error( output || `WP-CLI exited with code ${ exitCode }` );
				}
				return {
					content: [
						{ type: 'text' as const, text: output || 'Command completed with no output.' },
					],
				};
			} finally {
				await disconnectFromDaemon();
			}
		} catch ( error ) {
			throw new Error(
				`Failed to run WP-CLI command: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		promptSnippet: 'Run WP-CLI commands on a running site',
		annotations: REMOTE_OVERWRITE,
	}
);
