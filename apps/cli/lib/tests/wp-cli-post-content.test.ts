import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/wp-cli-post-content';

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
} );
