import { getUnsupportedWpCliPostContentMessage } from '../wp-cli-post-content';

describe( 'getUnsupportedWpCliPostContentMessage', () => {
	it( 'ignores commands other than post create and update', () => {
		expect(
			getUnsupportedWpCliPostContentMessage( [ 'option', 'update', 'blogname', '$(cat x)' ] )
		).toBeNull();
	} );

	it( 'accepts literal post content', () => {
		expect(
			getUnsupportedWpCliPostContentMessage( [ 'post', 'create', '--post_content=<p>Hello</p>' ] )
		).toBeNull();
	} );

	it( 'refuses JSON content that does not parse, with the parse error', () => {
		// The Global Styles update seen in an eval run, missing its last `}`.
		const content =
			'{"version":3,"isGlobalStylesUserThemeJSON":true,"styles":{"color":{"background":"#1e2a44"},"typography":{"lineHeight":"1.7"},"elements":{"link":{"color":{"text":"#8a3b1f"}}}}';

		const message = getUnsupportedWpCliPostContentMessage( [
			'post',
			'update',
			'5',
			`--post_content=${ content }`,
		] );

		expect( message ).toMatch(
			/^Nothing was saved: `--post_content` starts with `\{` but is not valid JSON \(.+\)/
		);
		expect(
			getUnsupportedWpCliPostContentMessage( [
				'post',
				'update',
				'5',
				`--post_content=${ content }}`,
			] )
		).toBeNull();
	} );

	it( 'returns an error message for cat command substitution in post content', () => {
		expect(
			getUnsupportedWpCliPostContentMessage( [
				'post',
				'create',
				'--post_content=$(cat /tmp/ane-page-content.txt)',
				'--post_type=page',
			] )
		).toContain( 'does not run in a shell' );
	} );

	it( 'returns an error message for backtick cat substitution', () => {
		expect(
			getUnsupportedWpCliPostContentMessage( [
				'post',
				'update',
				'12',
				'--post_content=`cat page.html`',
			] )
		).toContain( 'does not run in a shell' );
	} );

	it( 'refuses a file path, which WP-CLI would save as the content', () => {
		for ( const content of [
			'/Users/me/Studio/site/tmp/header.html',
			'tmp/header.html --porcelain',
			'tmp/styles.json',
		] ) {
			expect(
				getUnsupportedWpCliPostContentMessage( [
					'post',
					'update',
					'5',
					`--post_content=${ content }`,
				] )
			).toContain( 'not a file path' );
		}
		for ( const content of [
			'tmp',
			'See tmp/header.html',
			'<p>tmp/header.html</p>',
			'<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
		] ) {
			expect(
				getUnsupportedWpCliPostContentMessage( [ 'post', 'create', `--post_content=${ content }` ] )
			).toBeNull();
		}
	} );
} );
