import { randomUUID } from 'crypto';

export const UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE =
	'Unsupported `--post_content` value: `wp_cli` does not run in a shell. Do not use `$(cat file)` or backticks. Pass the literal post content directly and Studio will rewrite large content to a virtual temp file automatically.';

function generatePostContentTempFilePath(): string {
	return `/tmp/wp-cli-post-content-${ randomUUID() }.html`;
}

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
 * Rewrites WP-CLI args to replace `--post_content=...` with a temp file path.
 * Returns `null` if no rewriting is needed, otherwise returns `{ args, content, tempFilePath }`.
 */
export function rewriteWpCliPostContentArgs( args: string[] ): {
	args: string[];
	content: string;
	tempFilePath: string;
} | null {
	const isPostCommand =
		args[ 0 ] === 'post' && ( args[ 1 ] === 'create' || args[ 1 ] === 'update' );
	if ( ! isPostCommand ) {
		return null;
	}

	const contentArgIndex = args.findIndex( ( arg ) => arg.startsWith( '--post_content=' ) );
	if ( contentArgIndex === -1 ) {
		return null;
	}

	const content = args[ contentArgIndex ].slice( '--post_content='.length );
	const tempFilePath = generatePostContentTempFilePath();
	const rewrittenArgs = args.filter( ( _, i ) => i !== contentArgIndex );

	if ( args[ 1 ] === 'create' ) {
		rewrittenArgs.splice( 2, 0, tempFilePath );
	} else {
		// Find the post ID position — first non-flag arg after `post update` in the filtered array
		let insertIndex = 2;
		for ( let i = 2; i < rewrittenArgs.length; i++ ) {
			if ( ! rewrittenArgs[ i ].startsWith( '--' ) ) {
				insertIndex = i + 1;
				break;
			}
		}
		rewrittenArgs.splice( insertIndex, 0, tempFilePath );
	}

	return { args: rewrittenArgs, content, tempFilePath };
}

/**
 * For `post create` and `post update` commands, extracts `--post_content=...` from the args
 * and writes it to a temp file in the virtual filesystem. This avoids shell escaping issues
 * and argument length limits when dealing with long HTML content.
 *
 * WP-CLI accepts a file path as a positional argument for post content:
 *   - `wp post create <file>` reads content from file
 *   - `wp post update <id> <file>` reads content from file
 *
 * Returns the rewritten args array with the temp file as a positional argument.
 */
export async function rewriteWpCliPostContentToFile(
	args: string[],
	writeFile: ( path: string, content: string ) => Promise< void >
): Promise< string[] > {
	const unsupportedMessage = getUnsupportedWpCliPostContentMessage( args );
	if ( unsupportedMessage ) {
		throw new Error( unsupportedMessage );
	}

	const result = rewriteWpCliPostContentArgs( args );
	if ( ! result ) {
		return args;
	}

	await writeFile( result.tempFilePath, result.content );
	return result.args;
}
