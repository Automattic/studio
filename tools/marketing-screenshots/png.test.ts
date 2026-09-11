import { describe, expect, it } from 'vitest';
import { readPngMetadata } from './png.ts';

function createPngHeader( width: number, height: number ): Buffer {
	const header = Buffer.alloc( 24 );
	Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ).copy( header );
	header.writeUInt32BE( 13, 8 );
	header.write( 'IHDR', 12, 'ascii' );
	header.writeUInt32BE( width, 16 );
	header.writeUInt32BE( height, 20 );
	return header;
}

describe( 'readPngMetadata', () => {
	it( 'reads PNG dimensions without an image-processing dependency', () => {
		expect( readPngMetadata( createPngHeader( 3840, 2160 ) ) ).toEqual( {
			width: 3840,
			height: 2160,
			fileSizeBytes: 24,
		} );
	} );

	it( 'rejects non-PNG data and zero dimensions', () => {
		expect( () => readPngMetadata( Buffer.from( 'not a png' ) ) ).toThrow( 'not a valid PNG' );
		expect( () => readPngMetadata( createPngHeader( 0, 100 ) ) ).toThrow(
			'invalid zero dimensions'
		);
	} );
} );
