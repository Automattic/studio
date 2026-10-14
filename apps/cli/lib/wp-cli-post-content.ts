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
