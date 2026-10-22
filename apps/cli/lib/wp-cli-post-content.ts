import { existsSync, statSync } from 'fs';
import path from 'path';

const UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE =
	'Unsupported `--post_content` value: `wp_cli` does not run in a shell. Do not use `$(cat file)` or backticks. Pass the literal post content directly, or write large content to a scratch file inside the site directory and pass its path as a positional argument (`wp post create <file>`).';

function getPostContentArg( args: string[] ): string | undefined {
	const contentArg = args.find( ( arg ) => arg.startsWith( '--post_content=' ) );
	if ( ! contentArg ) {
		return undefined;
	}

	return contentArg.slice( '--post_content='.length );
}

export function getUnsupportedWpCliPostContentMessage( args: string[] ): string | null {
	const isPostCommand =
		args[ 0 ] === 'post' && ( args[ 1 ] === 'create' || args[ 1 ] === 'update' );
	if ( ! isPostCommand ) {
		return null;
	}

	const postContent = getPostContentArg( args );
	if ( postContent === undefined ) {
		return null;
	}

	const trimmedContent = postContent.trim();
	const hasCatCommandSubstitution =
		/^[`'"]?\$\(\s*cat\b[\s\S]*$/.test( trimmedContent ) ||
		/^[`'"]?`cat\b[\s\S]*$/.test( trimmedContent );

	return hasCatCommandSubstitution ? UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE : null;
}

/**
 * `post create` / `post update` with `--post_content=<file>`, where the value
 * is the path of a file (absolute or relative to the site): the same command
 * with the file as the positional argument WP-CLI reads content from, so the
 * post gets the file's content rather than its path. Unquoted content runs to
 * the end of the command, so flags after the path (`--porcelain`) are split
 * back out. Undefined for any other command.
 */
export function routePostContentFile(
	args: string[],
	sitePath?: string
): { args: string[]; file: string } | undefined {
	const isPostCommand =
		args[ 0 ] === 'post' && ( args[ 1 ] === 'create' || args[ 1 ] === 'update' );
	const contentIndex = args.findIndex( ( arg ) => arg.startsWith( '--post_content=' ) );
	if ( ! isPostCommand || contentIndex === -1 ) {
		return undefined;
	}
	const [ file, ...flags ] = args[ contentIndex ]
		.slice( '--post_content='.length )
		.trim()
		.split( /\s+/ );
	if ( ! file || file.includes( '<' ) || flags.some( ( flag ) => ! flag.startsWith( '--' ) ) ) {
		return undefined;
	}
	const filePath = path.resolve( sitePath ?? '', file );
	if ( ! existsSync( filePath ) || ! statSync( filePath ).isFile() ) {
		return undefined;
	}
	return {
		args: [ ...args.slice( 0, contentIndex ), ...args.slice( contentIndex + 1 ), ...flags, file ],
		file,
	};
}
