import { existsSync, statSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { checkBlockContent, hasBlockMarkup } from 'cli/ai/block-check';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/wp-cli-post-content';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { resolveSite } from './utils';
import type { SiteData } from 'cli/lib/cli-config/core';

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

// Post content reaches the site through `post create` and `post update`, inline
// or from a file. It is checked in the site's block editor first: lossless
// re-serializations are kept, and content the editor rejects is not saved.
async function checkPostContent(
	site: SiteData,
	args: string[]
): Promise< { args: string[]; report?: string } > {
	if ( args[ 0 ] !== 'post' || ( args[ 1 ] !== 'create' && args[ 1 ] !== 'update' ) ) {
		return { args };
	}
	const marker = '--post_content=';
	const inlineIndex = args.findIndex( ( arg ) => arg.startsWith( marker ) );
	let label: string;
	let content: string;
	let keep: ( fixed: string ) => Promise< string[] >;
	if ( inlineIndex !== -1 ) {
		label = 'post_content';
		content = args[ inlineIndex ].slice( marker.length );
		keep = async ( fixed ) =>
			args.map( ( arg, i ) => ( i === inlineIndex ? marker + fixed : arg ) );
	} else {
		const file = args
			.slice( 2 )
			.filter( ( arg ) => ! arg.startsWith( '-' ) )
			.map( ( arg ) => ( { arg, filePath: path.resolve( site.path, arg ) } ) )
			.find( ( { filePath } ) => existsSync( filePath ) && statSync( filePath ).isFile() );
		if ( ! file ) {
			return { args };
		}
		label = file.arg;
		content = await readFile( file.filePath, 'utf8' );
		keep = async ( fixed ) => {
			await writeFile( file.filePath, fixed, 'utf8' );
			return args;
		};
	}
	if ( ! hasBlockMarkup( content ) ) {
		return { args };
	}
	const check = await checkBlockContent( content, getSiteUrl( site ), label );
	if ( ! check.passed ) {
		throw new Error( `${ check.report }\nNothing was saved.` );
	}
	return {
		args: check.content === content ? args : await keep( check.content ),
		report: check.report,
	};
}

export const runWpCliTool = defineTool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running (site_start if needed). ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list". ' +
		'The command takes literal arguments, not shell syntax — never use shell substitution or shell syntax such as `$(cat file)`, backticks, pipes, redirection, or environment variables to provide post content. ' +
		'For large post content, write the markup to a scratch file inside the site directory and pass its path to `post create <file>` (or `post update <id> <file>`) — this avoids the OS command-length limit. For smaller content you may instead pass it inline with `--post_content=...` as the final argument. ' +
		"`post create` and `post update` check block content in the site's block editor before saving it: re-serializations the editor makes without loss are kept and shown as a diff, and content the editor rejects is not saved, with the reasons. " +
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

				const wpCliArgs = splitCommandArgs( args.command );
				const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( wpCliArgs );
				if ( unsupportedOptionMessage ) {
					throw new Error( unsupportedOptionMessage );
				}
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					throw new Error( unsupportedPostContentMessage );
				}

				const postContent = await checkPostContent( site, wpCliArgs );

				await using command = await runWpCliCommand( site, postContent.args );
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
				if ( postContent.report ) {
					output = output.trimEnd();
					output += ( output ? '\n\n' : '' ) + postContent.report;
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
