import { Type } from 'typebox';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/rewrite-wp-cli-post-content';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { defineTool } from './define-tool';
import { resolveSite } from './utils';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';

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

// Quoted post_content needs trailing flags split out (e.g. `--porcelain`
// after the closing quote); unquoted block markup is treated as a single
// literal arg through end-of-command.
function splitPostContentCommandArgs( command: string, postContentIndex: number ): string[] {
	const postContentMarker = '--post_content=';
	const prefix = command.slice( 0, postContentIndex ).trim();
	const postContentTail = command.slice( postContentIndex + postContentMarker.length ).trim();
	const prefixArgs = splitBasicCommandArgs( prefix );

	if ( ! postContentTail ) {
		return [ ...prefixArgs, postContentMarker ];
	}

	const quote = postContentTail[ 0 ];
	if ( quote === '"' || quote === "'" ) {
		const closingQuoteIndex = postContentTail.indexOf( quote, 1 );
		if ( closingQuoteIndex !== -1 ) {
			const postContent = postContentTail.slice( 1, closingQuoteIndex );
			const suffix = postContentTail.slice( closingQuoteIndex + 1 ).trim();
			return [
				...prefixArgs,
				`${ postContentMarker }${ postContent }`,
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

function getWpCliOptionValue( args: string[], optionName: string ): string | undefined {
	const prefix = `${ optionName }=`;
	for ( let index = 0; index < args.length; index++ ) {
		const arg = args[ index ];
		if ( arg === optionName ) {
			return args[ index + 1 ];
		}
		if ( arg.startsWith( prefix ) ) {
			return arg.slice( prefix.length );
		}
	}
	return undefined;
}

function getCreatedPostIdFromOutput( stdout: string ): number | null {
	const trimmed = stdout.trim();
	const directId = Number.parseInt( trimmed, 10 );
	if ( /^\d+$/.test( trimmed ) && directId > 0 ) {
		return directId;
	}

	const successMatch = trimmed.match( /Created (?:post|page) (\d+)/i );
	if ( successMatch ) {
		const parsed = Number.parseInt( successMatch[ 1 ], 10 );
		return parsed > 0 ? parsed : null;
	}

	return null;
}

function getWpCliArtifacts(
	args: string[],
	stdout: string
): StudioChatArtifactWidgetDraft[] | undefined {
	if ( args[ 0 ] !== 'post' || args[ 1 ] !== 'create' ) {
		return undefined;
	}

	const postId = getCreatedPostIdFromOutput( stdout );
	if ( ! postId ) {
		return undefined;
	}

	const postType = getWpCliOptionValue( args, '--post_type' ) ?? 'post';
	if ( postType === 'page' ) {
		return [ { type: 'page', widgetProps: { pageId: postId, tone: 'neutral' } } ];
	}
	if ( postType === 'post' ) {
		return [ { type: 'post', widgetProps: { postId } } ];
	}

	return undefined;
}

export const runWpCliTool = defineTool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list".',
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
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					throw new Error( unsupportedPostContentMessage );
				}

				await using command = await runWpCliCommandWithMessaging( site, wpCliArgs );
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
					throw new Error( output || `WP-CLI exited with code ${ exitCode }` );
				}
				return {
					content: [
						{ type: 'text' as const, text: output || 'Command completed with no output.' },
					],
					studioArtifacts: getWpCliArtifacts( wpCliArgs, stdout ),
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
	}
);
