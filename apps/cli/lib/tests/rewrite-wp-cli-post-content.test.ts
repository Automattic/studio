import { vi } from 'vitest';
import {
	getUnsupportedWpCliPostContentMessage,
	rewriteWpCliPostContentArgs,
	rewriteWpCliPostContentToFile,
} from 'cli/lib/rewrite-wp-cli-post-content';

describe( 'rewriteWpCliPostContentArgs', () => {
	it( 'should return null for non-post commands', () => {
		expect( rewriteWpCliPostContentArgs( [ 'option', 'get', 'blogname' ] ) ).toBeNull();
	} );

	it( 'should return null for post list', () => {
		expect( rewriteWpCliPostContentArgs( [ 'post', 'list', '--post_type=page' ] ) ).toBeNull();
	} );

	it( 'should return null if no --post_content argument', () => {
		expect(
			rewriteWpCliPostContentArgs( [ 'post', 'create', '--post_type=page', '--post_title=Hello' ] )
		).toBeNull();
	} );

	it( 'should rewrite post create with --post_content to use temp file', () => {
		const result = rewriteWpCliPostContentArgs( [
			'post',
			'create',
			'--post_content=<h1>Hello World</h1>',
			'--post_type=page',
			'--post_title=Test',
		] );

		expect( result ).not.toBeNull();
		expect( result!.content ).toBe( '<h1>Hello World</h1>' );
		expect( result!.tempFilePath ).toMatch( /^\/tmp\/wp-cli-post-content-.+\.html$/ );
		expect( result!.args[ 0 ] ).toBe( 'post' );
		expect( result!.args[ 1 ] ).toBe( 'create' );
		expect( result!.args[ 2 ] ).toBe( result!.tempFilePath );
		expect( result!.args ).toContain( '--post_type=page' );
		expect( result!.args ).toContain( '--post_title=Test' );
		expect( result!.args.join( ' ' ) ).not.toContain( '--post_content=' );
	} );

	it( 'should rewrite post update with --post_content to use temp file', () => {
		const result = rewriteWpCliPostContentArgs( [
			'post',
			'update',
			'42',
			'--post_content=<p>Updated content</p>',
			'--post_title=Updated',
		] );

		expect( result ).not.toBeNull();
		expect( result!.content ).toBe( '<p>Updated content</p>' );
		expect( result!.args[ 0 ] ).toBe( 'post' );
		expect( result!.args[ 1 ] ).toBe( 'update' );
		expect( result!.args[ 2 ] ).toBe( '42' );
		expect( result!.args[ 3 ] ).toBe( result!.tempFilePath );
		expect( result!.args ).toContain( '--post_title=Updated' );
		expect( result!.args.join( ' ' ) ).not.toContain( '--post_content=' );
	} );

	it( 'should handle post update with flags before post ID', () => {
		const result = rewriteWpCliPostContentArgs( [
			'post',
			'update',
			'--porcelain',
			'99',
			'--post_content=<p>Content</p>',
		] );

		expect( result ).not.toBeNull();
		expect( result!.args[ 0 ] ).toBe( 'post' );
		expect( result!.args[ 1 ] ).toBe( 'update' );
		expect( result!.args[ 2 ] ).toBe( '--porcelain' );
		expect( result!.args[ 3 ] ).toBe( '99' );
		expect( result!.args[ 4 ] ).toBe( result!.tempFilePath );
	} );

	it( 'should use a unique temp file path each call', () => {
		const result1 = rewriteWpCliPostContentArgs( [ 'post', 'create', '--post_content=Content 1' ] );
		const result2 = rewriteWpCliPostContentArgs( [ 'post', 'create', '--post_content=Content 2' ] );

		expect( result1 ).not.toBeNull();
		expect( result2 ).not.toBeNull();
		expect( result1!.tempFilePath ).not.toBe( result2!.tempFilePath );
	} );

	it( 'should handle empty post content', () => {
		const result = rewriteWpCliPostContentArgs( [
			'post',
			'create',
			'--post_content=',
			'--post_type=page',
		] );

		expect( result ).not.toBeNull();
		expect( result!.content ).toBe( '' );
		expect( result!.args[ 2 ] ).toBe( result!.tempFilePath );
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
} );

describe( 'rewriteWpCliPostContentToFile', () => {
	it( 'should return args unchanged for non-post commands', async () => {
		const writeFile = vi.fn();
		const args = [ 'option', 'get', 'blogname' ];
		const result = await rewriteWpCliPostContentToFile( args, writeFile );
		expect( result ).toEqual( args );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'should write content to temp file and return rewritten args', async () => {
		const writeFile = vi.fn().mockResolvedValue( undefined );
		const result = await rewriteWpCliPostContentToFile(
			[ 'post', 'create', '--post_content=<h1>Hello</h1>', '--post_type=page' ],
			writeFile
		);

		expect( writeFile ).toHaveBeenCalledWith(
			expect.stringMatching( /^\/tmp\/wp-cli-post-content-.+\.html$/ ),
			'<h1>Hello</h1>'
		);
		expect( result[ 0 ] ).toBe( 'post' );
		expect( result[ 1 ] ).toBe( 'create' );
		expect( result[ 2 ] ).toMatch( /^\/tmp\/wp-cli-post-content-.+\.html$/ );
		expect( result ).toContain( '--post_type=page' );
		expect( result.join( ' ' ) ).not.toContain( '--post_content=' );
	} );

	it( 'rejects cat command substitution in post content', async () => {
		const writeFile = vi.fn();

		await expect(
			rewriteWpCliPostContentToFile(
				[
					'post',
					'create',
					'--post_content="$(cat /tmp/ane-page-content.txt)"',
					'--post_type=page',
				],
				writeFile
			)
		).rejects.toThrow( 'does not run in a shell' );

		expect( writeFile ).not.toHaveBeenCalled();
	} );
} );
