import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
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

	describe( 'a file path passed as the content', () => {
		const sitePath = mkdtempSync( path.join( os.tmpdir(), 'post-content-path-' ) );
		mkdirSync( path.join( sitePath, 'tmp' ) );
		writeFileSync( path.join( sitePath, 'tmp', 'header.html' ), '<!-- wp:paragraph -->' );

		it( 'refuses an absolute path and names the command that reads the file', () => {
			const file = path.join( sitePath, 'tmp', 'header.html' );
			const message = getUnsupportedWpCliPostContentMessage(
				[ 'post', 'update', '5', `--post_content=${ file }` ],
				sitePath
			);
			expect( message ).toContain( 'Nothing was saved' );
			expect( message ).toContain( `\`post update 5 ${ file }\` saves the file's content` );
		} );

		it( 'refuses a path relative to the site, with flags after it', () => {
			expect(
				getUnsupportedWpCliPostContentMessage(
					[ 'post', 'create', '--post_type=page', '--post_content=tmp/header.html --porcelain' ],
					sitePath
				)
			).toContain( '`post create tmp/header.html`' );
		} );

		it( 'accepts content that only looks like a path', () => {
			for ( const content of [
				'tmp/missing.html',
				'tmp',
				'See tmp/header.html',
				'tmp/header.html and more',
			] ) {
				expect(
					getUnsupportedWpCliPostContentMessage(
						[ 'post', 'create', `--post_content=${ content }` ],
						sitePath
					)
				).toBeNull();
			}
		} );
	} );
} );
