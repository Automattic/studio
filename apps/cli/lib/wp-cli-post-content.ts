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

// The file a `--post_content` value names, absolute or relative to the site,
// as in `--post_content=tmp/page.html`. Unquoted content runs to the end of the
// command, so flags after the path (`--porcelain`) are part of the value.
function namedFile( value: string, sitePath?: string ): string | undefined {
	const [ candidate, ...rest ] = value.split( /\s+/ );
	if (
		! candidate ||
		candidate.includes( '<' ) ||
		rest.some( ( arg ) => ! arg.startsWith( '--' ) )
	) {
		return undefined;
	}
	const filePath = path.resolve( sitePath ?? '', candidate );
	return existsSync( filePath ) && statSync( filePath ).isFile() ? candidate : undefined;
}

export function getUnsupportedWpCliPostContentMessage(
	args: string[],
	sitePath?: string
): string | null {
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

	if ( hasCatCommandSubstitution ) {
		return UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE;
	}

	const file = namedFile( trimmedContent, sitePath );
	if ( file ) {
		const target = args[ 1 ] === 'update' ? `post update ${ args[ 2 ] ?? '<id>' }` : 'post create';
		return `\`--post_content\` takes the content itself, and \`${ file }\` is the path of a file, so the post would be saved with that path as its content. Nothing was saved. \`${ target } ${ file }\` saves the file's content.`;
	}

	return null;
}
