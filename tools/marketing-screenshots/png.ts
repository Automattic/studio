import { readFile } from 'node:fs/promises';

const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

export interface PngMetadata {
	width: number;
	height: number;
	fileSizeBytes: number;
}

export async function validatePng(
	filePath: string,
	expected: { width: number; height: number }
): Promise< PngMetadata > {
	const contents = await readFile( filePath );
	const metadata = readPngMetadata( contents );

	if ( metadata.width !== expected.width || metadata.height !== expected.height ) {
		throw new Error(
			`Screenshot dimensions are ${ metadata.width }x${ metadata.height }; ` +
				`expected ${ expected.width }x${ expected.height }.`
		);
	}

	const minimumUsefulSize = Math.max(
		1_024,
		Math.floor( expected.width * expected.height * 0.002 )
	);
	if ( metadata.fileSizeBytes < minimumUsefulSize ) {
		throw new Error(
			`Screenshot is unexpectedly small (${ metadata.fileSizeBytes } bytes; ` +
				`minimum ${ minimumUsefulSize } bytes). It may be blank.`
		);
	}

	return metadata;
}

export function readPngMetadata( contents: Buffer ): PngMetadata {
	if ( contents.length < 24 || ! contents.subarray( 0, 8 ).equals( PNG_SIGNATURE ) ) {
		throw new Error( 'Screenshot is not a valid PNG file.' );
	}

	const chunkType = contents.toString( 'ascii', 12, 16 );
	if ( chunkType !== 'IHDR' ) {
		throw new Error( 'Screenshot PNG does not start with an IHDR chunk.' );
	}

	const width = contents.readUInt32BE( 16 );
	const height = contents.readUInt32BE( 20 );
	if ( width === 0 || height === 0 ) {
		throw new Error( 'Screenshot PNG has invalid zero dimensions.' );
	}

	return {
		width,
		height,
		fileSizeBytes: contents.length,
	};
}
