import { randomUUID } from 'crypto';

function generatePostContentTempFilePath(): string {
	return `/tmp/wp-cli-post-content-${ randomUUID() }.html`;
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
 * Extracts `--post_content=...` from WP-CLI args and writes it to a temp file
 * to avoid shell escaping issues with long HTML content.
 */
export async function rewriteWpCliPostContentToFile(
	args: string[],
	writeFile: ( path: string, content: string ) => Promise< void >
): Promise< string[] > {
	const result = rewriteWpCliPostContentArgs( args );
	if ( ! result ) {
		return args;
	}

	await writeFile( result.tempFilePath, result.content );
	return result.args;
}
