// src/lib/fidelity/evidence.ts
//
// Optional PNG pair + diff for a human looking at a compare failure.
// The pixel score is never a pass/fail input — that is how 0.98 blessed the freeze.
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface PixelEvidence {
	score: number;
	sourcePath: string;
	liberatedPath: string;
	diffPath: string;
}

export function writePixelEvidence(
	directory: string,
	sourcePng: Buffer,
	liberatedPng: Buffer
): PixelEvidence | { error: string } {
	mkdirSync( directory, { recursive: true } );
	const sourcePath = join( directory, 'source.png' );
	const liberatedPath = join( directory, 'liberated.png' );
	const diffPath = join( directory, 'diff.png' );
	writeFileSync( sourcePath, sourcePng );
	writeFileSync( liberatedPath, liberatedPng );

	const source = PNG.sync.read( sourcePng );
	const liberated = PNG.sync.read( liberatedPng );
	if ( source.width !== liberated.width || source.height !== liberated.height ) {
		return {
			error: `screenshot size ${ liberated.width }x${ liberated.height } !== source ${ source.width }x${ source.height }`,
		};
	}

	const diff = new PNG( { width: source.width, height: source.height } );
	const diffPixels = pixelmatch(
		source.data,
		liberated.data,
		diff.data,
		source.width,
		source.height,
		{ threshold: 0.1 }
	);
	writeFileSync( diffPath, PNG.sync.write( diff ) );
	const score = 1 - diffPixels / ( source.width * source.height );
	return { score, sourcePath, liberatedPath, diffPath };
}
