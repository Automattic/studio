const UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE =
	'Unsupported `--post_content` value: `wp_cli` does not run in a shell, so `$(cat file)` and backticks would reach WP-CLI as literal text. Pass the literal post content directly, or write large content to a scratch file inside the site directory and pass its path as a positional argument (`wp post create <file>`).';

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

	if ( hasCatCommandSubstitution ) {
		return UNSUPPORTED_WP_CLI_POST_CONTENT_MESSAGE;
	}

	// WP-CLI saves a path given as `--post_content` as the content itself and
	// reports success, which wipes the post.
	if ( /^[^\s<]+\.(html?|txt|md|json)(\s+--\S+)*$/i.test( trimmedContent ) ) {
		return 'Nothing was saved: `--post_content` takes the content itself, not a file path. To save the content of a file, pass its path as a positional argument: `post create <file>` or `post update <id> <file>`.';
	}

	// Block markup and HTML never start with `{`, so content that does is JSON,
	// such as a Global Styles post. WordPress ignores JSON post content that
	// does not parse, while WP-CLI still saves it and reports success.
	if ( trimmedContent.startsWith( '{' ) ) {
		try {
			JSON.parse( trimmedContent );
		} catch ( error ) {
			const reason = error instanceof Error ? error.message : String( error );
			return `Nothing was saved: \`--post_content\` starts with \`{\` but is not valid JSON (${ reason }). WordPress ignores JSON post content that does not parse.`;
		}
	}

	return null;
}
