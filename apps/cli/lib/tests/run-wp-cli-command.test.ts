import { once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { teeToBoundedTail } from '../run-wp-cli-command';

async function readText( stream: PassThrough ): Promise< string > {
	const chunks: Buffer[] = [];
	for await ( const chunk of stream ) {
		chunks.push( Buffer.from( chunk ) );
	}
	return Buffer.concat( chunks ).toString();
}

describe( 'teeToBoundedTail', () => {
	it( 'pauses for a slow destination, resumes on drain, and retains a 64 KiB tail', async () => {
		const source = new PassThrough();
		const received: Buffer[] = [];
		let releaseWrite: () => void;
		const destination = new Writable( {
			write( chunk, _encoding, callback ) {
				received.push( Buffer.from( chunk ) );
				releaseWrite = callback;
			},
			highWaterMark: 1,
		} );
		const onOutput = vi.fn();
		const tail = teeToBoundedTail( source, destination, onOutput ) as PassThrough;
		const resumeSpy = vi.spyOn( source, 'resume' );
		const output = Buffer.alloc( 128 * 1024, 'x' );

		source.write( output );
		expect( source.isPaused() ).toBe( true );
		expect( onOutput ).toHaveBeenCalledOnce();
		const drained = once( destination, 'drain' );
		releaseWrite!();
		await drained;
		expect( resumeSpy ).toHaveBeenCalledOnce();
		source.end();

		expect( await readText( tail ) ).toBe( output.subarray( -( 64 * 1024 ) ).toString() );
		expect( Buffer.concat( received ) ).toEqual( output );
	} );

	it( 'propagates a destination error and destroys the source', async () => {
		const source = new PassThrough();
		const destination = new Writable( {
			write( _chunk, _encoding, callback ) {
				callback( new Error( 'terminal unavailable' ) );
			},
		} );
		const tail = teeToBoundedTail( source, destination );

		const failure = expect( readText( tail as PassThrough ) ).rejects.toThrow(
			'terminal unavailable'
		);
		source.write( 'progress' );

		await failure;
		expect( source.destroyed ).toBe( true );
	} );

	it( 'propagates a source error without retaining unbounded output', async () => {
		const source = new PassThrough();
		const tail = teeToBoundedTail( source ) as PassThrough;
		const failure = expect( readText( tail ) ).rejects.toThrow( 'import pipe failed' );

		source.emit( 'error', new Error( 'import pipe failed' ) );

		await failure;
	} );
} );
