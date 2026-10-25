import { Type } from 'typebox';
import { splitCommandArgs } from 'cli/ai/wp-cli-args';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/wp-cli-post-content';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { resolveSite } from './utils';
import type { AnyStudioAgentTool } from './define-tool';

// LLMs sometimes emit en/em dashes (`‐porcelain`, `–color`); WP-CLI silently
// ignores them, so reject up-front and let the agent retry with ASCII hyphens.
function getUnsupportedWpCliOptionMessage( args: string[] ): string | null {
	const unsupportedOption = args.find( ( arg ) => /^[‐-―]\S+/.test( arg ) );
	if ( ! unsupportedOption ) {
		return null;
	}
	return `Unsupported WP-CLI option "${ unsupportedOption }": use ASCII hyphens, for example "--porcelain", not a typographic dash.`;
}

const SHELL_SEPARATORS = new Set( [ '&&', '||', ';', '|' ] );

// The `db` commands that run a MySQL client (query, export, cli…) connect with
// wp-config.php's credentials, which a Studio site, stored in SQLite, leaves
// as placeholders: the client reports MySQL's access denied (error 1045).
function sqliteNote( output: string ): string {
	return /\b1045\b.*Access denied/.test( output )
		? '\nThis site stores its database in SQLite (wp-content/database/.ht.sqlite), with no MySQL server for a MySQL client to connect to. Read WordPress data with object commands such as `post list`, `option get` or `user list`, or with `eval` and WordPress functions.'
		: '';
}

export const runWpCliTool = defineTool(
	'wp_cli',
	'Runs one WP-CLI command on a WordPress site, with literal arguments and no shell. ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list". ' +
		'For large post content, write the validated markup to a scratch file inside the site directory and pass its path to `post create <file>` (or `post update <id> <file>`) — this avoids the OS command-length limit. For smaller content you may instead pass it inline with `--post_content=...` as the final argument. ' +
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

				const wpCliArgs = splitCommandArgs( args.command );
				const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( wpCliArgs );
				if ( unsupportedOptionMessage ) {
					throw new Error( unsupportedOptionMessage );
				}
				const separator = wpCliArgs.find( ( arg ) => SHELL_SEPARATORS.has( arg ) );
				if ( separator ) {
					throw new Error(
						`Not run: \`${ separator }\` joins commands in a shell, and wp_cli runs one WP-CLI command without a shell. Run each command in its own wp_cli call.`
					);
				}
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					throw new Error( unsupportedPostContentMessage );
				}

				await using command = await runWpCliCommand( site, wpCliArgs );
				const exitCode = await command.response.exitCode;
				const stdout = await command.response.stdoutText;
				const stderr = await command.response.stderrText;

				let output = '';
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
					throw new Error(
						( output || `WP-CLI exited with code ${ exitCode }` ) + sqliteNote( output )
					);
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
		annotations: REMOTE_OVERWRITE,
		// An agent with a shell runs `wp` there.
		forHost: ( host ): AnyStudioAgentTool | undefined => ( host.shell ? undefined : runWpCliTool ),
	}
);
