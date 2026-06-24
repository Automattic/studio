import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { PLAYGROUND_WP_CLI_SHEBANG_PREFIX, stripLeadingShebang } from 'cli/lib/wp-cli-shebang';

const SHEBANG_LINE = `${ PLAYGROUND_WP_CLI_SHEBANG_PREFIX } php\n`;

// Build a Readable that emits the given pieces as discrete chunks, so we can
// exercise how `stripLeadingShebang` copes with different chunk boundaries.
function streamOf( ...chunks: Array< string | Buffer > ): Readable {
	return Readable.from( chunks.map( ( chunk ) => Buffer.from( chunk ) ) );
}

describe( 'stripLeadingShebang', () => {
	it( 'drops the shebang when it arrives as its own chunk (streaming runtime)', async () => {
		const result = await text(
			stripLeadingShebang( streamOf( SHEBANG_LINE, 'blogname value\n' ) )
		);
		expect( result ).toBe( 'blogname value\n' );
	} );

	it( 'drops the shebang glued to the first line of output in one chunk (messaging runtime)', async () => {
		// This is the exact shape the messaging path builds: the whole buffered
		// response as a single chunk starting with the shebang. The earlier
		// regression left a stray `php` line here.
		const result = await text( stripLeadingShebang( streamOf( `${ SHEBANG_LINE }123\n` ) ) );
		expect( result ).toBe( '123\n' );
		expect( result ).not.toContain( 'php' );
	} );

	it( 'drops the shebang when it is split across chunks', async () => {
		const result = await text(
			stripLeadingShebang( streamOf( '#!/usr/b', 'in/env php\nSuccess: done.\n' ) )
		);
		expect( result ).toBe( 'Success: done.\n' );
	} );

	it( 'preserves meaningful leading and trailing whitespace in real output', async () => {
		const result = await text(
			stripLeadingShebang( streamOf( `${ SHEBANG_LINE }  spaced value  \n` ) )
		);
		expect( result ).toBe( '  spaced value  \n' );
	} );

	it( 'passes output through untouched when there is no shebang', async () => {
		const result = await text(
			stripLeadingShebang( streamOf( 'no shebang here\nsecond line\n' ) )
		);
		expect( result ).toBe( 'no shebang here\nsecond line\n' );
	} );

	it( 'emits nothing when the shebang line is the entire output', async () => {
		const result = await text( stripLeadingShebang( streamOf( SHEBANG_LINE ) ) );
		expect( result ).toBe( '' );
	} );

	it( 'forwards a partial prefix that never completes into a shebang', async () => {
		const result = await text( stripLeadingShebang( streamOf( '#!/' ) ) );
		expect( result ).toBe( '#!/' );
	} );

	it( 'yields Buffer chunks so byte consumers (process.stdout.write) work', async () => {
		const stream = stripLeadingShebang( streamOf( `${ SHEBANG_LINE }123\n` ) );
		const chunks: unknown[] = [];
		for await ( const chunk of stream ) {
			chunks.push( chunk );
		}
		expect( chunks.length ).toBeGreaterThan( 0 );
		expect( chunks.every( ( chunk ) => Buffer.isBuffer( chunk ) ) ).toBe( true );
		expect( Buffer.concat( chunks as Buffer[] ).toString() ).toBe( '123\n' );
	} );

	it( 'propagates source errors to the consumer', async () => {
		const source = new Readable( {
			read() {
				this.destroy( new Error( 'boom' ) );
			},
		} );
		await expect( text( stripLeadingShebang( source ) ) ).rejects.toThrow( 'boom' );
	} );
} );
