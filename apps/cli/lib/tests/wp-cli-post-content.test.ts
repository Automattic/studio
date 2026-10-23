import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
	getUnsupportedWpCliPostContentMessage,
	routePostContentFile,
} from 'cli/lib/wp-cli-post-content';

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

describe( 'routePostContentFile', () => {
	const sitePath = mkdtempSync( path.join( os.tmpdir(), 'post-content-path-' ) );
	mkdirSync( path.join( sitePath, 'tmp' ) );
	writeFileSync( path.join( sitePath, 'tmp', 'header.html' ), '<!-- wp:paragraph -->' );

	it( 'passes an absolute file path as the file WP-CLI reads content from', () => {
		const file = path.join( sitePath, 'tmp', 'header.html' );
		expect(
			routePostContentFile( [ 'post', 'update', '5', `--post_content=${ file }` ], sitePath )
		).toEqual( { args: [ 'post', 'update', '5', file ], file } );
	} );

	it( 'keeps the flags around a relative path', () => {
		expect(
			routePostContentFile(
				[ 'post', 'create', '--post_type=page', '--post_content=tmp/header.html --porcelain' ],
				sitePath
			)
		).toEqual( {
			args: [ 'post', 'create', '--post_type=page', '--porcelain', 'tmp/header.html' ],
			file: 'tmp/header.html',
		} );
	} );

	it( 'leaves content that only looks like a path, and other commands, alone', () => {
		for ( const content of [
			'tmp/missing.html',
			'tmp',
			'See tmp/header.html',
			'tmp/header.html and more',
			'<p>tmp/header.html</p>',
		] ) {
			expect(
				routePostContentFile( [ 'post', 'create', `--post_content=${ content }` ], sitePath )
			).toBeUndefined();
		}
		expect(
			routePostContentFile(
				[ 'option', 'update', 'x', '--post_content=tmp/header.html' ],
				sitePath
			)
		).toBeUndefined();
	} );

	it( 'leaves a file outside the site folder alone', () => {
		const outside = mkdtempSync( path.join( os.tmpdir(), 'post-content-outside-' ) );
		writeFileSync( path.join( outside, 'notes.html' ), 'x' );
		for ( const file of [
			path.join( outside, 'notes.html' ),
			`../${ path.basename( outside ) }/notes.html`,
		] ) {
			expect(
				routePostContentFile( [ 'post', 'create', `--post_content=${ file }` ], sitePath )
			).toBeUndefined();
		}
	} );
} );
