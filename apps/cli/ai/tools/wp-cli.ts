import { z } from 'zod/v4';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/rewrite-wp-cli-post-content';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { tool } from './define-tool';
import { errorResult, resolveSite } from './utils';

/**
 * Split a command string into arguments, respecting quoted strings.
 *
 * Handles both single and double quotes, e.g.:
 *   post create --post_title="Ember & Oak" --post_type=page
 *   → ['post', 'create', '--post_title=Ember & Oak', '--post_type=page']
 *
 * Special-cases `--post_content=`: large block payloads are commonly emitted
 * without shell quoting, so we treat everything after the marker as a single
 * literal argument and strip any matching outer quotes.
 *
 * Private to wp-cli.ts: this is the only caller, and the heuristics here
 * are tightly coupled to how WP-CLI's argument parser interprets shell-ish
 * input.
 */
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

function splitCommandArgs( command: string ): string[] {
	const postContentMarker = '--post_content=';
	const postContentIndex = command.indexOf( postContentMarker );

	// Large block content is commonly emitted without shell quoting and should
	// be treated as a single literal argument that consumes the rest of the command.
	if ( postContentIndex !== -1 ) {
		const prefix = command.slice( 0, postContentIndex ).trim();
		const postContent = stripMatchingOuterQuotes(
			command.slice( postContentIndex + postContentMarker.length ).trim()
		);

		return [ ...splitBasicCommandArgs( prefix ), `${ postContentMarker }${ postContent }` ];
	}

	return splitBasicCommandArgs( command );
}

// Note: wp.ts runCommand calls process.exit(), so we use the lower-level sendWpCliCommand directly.
export const runWpCliTool = tool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running. ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list".',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
		command: z
			.string()
			.describe(
				'The WP-CLI command to run (without the "wp" prefix). Example: "plugin list --status=active"'
			),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connectToDaemon();

				const runningProcess = await isServerRunning( site.id );
				if ( ! runningProcess ) {
					return errorResult(
						`Site "${ site.name }" is not running. Start it first using site_start.`
					);
				}

				const wpCliArgs = splitCommandArgs( args.command );
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					return errorResult( unsupportedPostContentMessage );
				}

				const result = await sendWpCliCommand( site.id, wpCliArgs );

				let output = '';
				if ( result.stdout ) {
					output += result.stdout;
				}
				if ( result.stderr ) {
					output += ( output ? '\n' : '' ) + `stderr: ${ result.stderr }`;
				}
				if ( result.exitCode !== 0 ) {
					output += `\nExit code: ${ result.exitCode }`;
				}

				return {
					content: [
						{ type: 'text' as const, text: output || 'Command completed with no output.' },
					],
					isError: result.exitCode !== 0,
				};
			} finally {
				await disconnectFromDaemon();
			}
		} catch ( error ) {
			return errorResult(
				`Failed to run WP-CLI command: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
